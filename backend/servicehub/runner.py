"""Process management: venvs, scheduled/manual script runs, supervised workers and web apps."""

import asyncio
import hashlib
import json
import logging
import os
import shutil
import signal
import sys
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from croniter import croniter

from . import config, db, files, notify

log = logging.getLogger("servicehub.runner")

LOG_LINES = 2000
CRASH_WINDOW = 120  # seconds
CRASH_LIMIT = 5  # crashes within window → give up


# ---- event bus ---------------------------------------------------------------

class EventBus:
    def __init__(self) -> None:
        self.subs: set[asyncio.Queue] = set()

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=200)
        self.subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self.subs.discard(q)

    def publish(self, event: dict) -> None:
        for q in list(self.subs):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass


bus = EventBus()


# ---- logs --------------------------------------------------------------------

class LogBuffer:
    """Ring buffer of log lines with live subscribers and an append-only file."""

    def __init__(self, path: Path | None, max_file_bytes: int = 5 * 1024 * 1024) -> None:
        self.lines: deque[dict] = deque(maxlen=LOG_LINES)
        self.subs: set[asyncio.Queue] = set()
        self.path = path
        self.max_file_bytes = max_file_bytes
        self.closed = False
        if path:
            path.parent.mkdir(parents=True, exist_ok=True)

    def write(self, stream: str, text: str) -> None:
        entry = {"t": db.now_iso(), "s": stream, "l": text.rstrip("\n")}
        self.lines.append(entry)
        if self.path:
            try:
                if self.path.exists() and self.path.stat().st_size > self.max_file_bytes:
                    self.path.replace(self.path.with_suffix(".log.1"))
                with self.path.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(entry) + "\n")
            except OSError:
                pass
        for q in list(self.subs):
            try:
                q.put_nowait(entry)
            except asyncio.QueueFull:
                pass

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=2000)
        self.subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self.subs.discard(q)

    def close(self) -> None:
        self.closed = True
        for q in list(self.subs):
            try:
                q.put_nowait(None)
            except asyncio.QueueFull:
                pass

    def clear(self) -> None:
        self.lines.clear()


def read_log_file(path: Path, limit: int = LOG_LINES) -> list[dict]:
    if not path.exists():
        return []
    out: deque[dict] = deque(maxlen=limit)
    with path.open(encoding="utf-8", errors="replace") as f:
        for line in f:
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                out.append({"t": "", "s": "out", "l": line.rstrip("\n")})
    return list(out)


# ---- helpers -----------------------------------------------------------------

def get_service(slug: str) -> dict | None:
    row = db.one("SELECT * FROM services WHERE slug=?", (slug,))
    return db.service_row_to_dict(row) if row else None


def get_service_by_id(sid: int) -> dict | None:
    row = db.one("SELECT * FROM services WHERE id=?", (sid,))
    return db.service_row_to_dict(row) if row else None


def app_port(service: dict) -> int:
    return config.APP_PORT_BASE + int(service["id"])


def base_python() -> str:
    return sys.executable


def uv_bin() -> str | None:
    return shutil.which("uv")


TILE_PREFIX = "::tile::"
TONES = ("up", "down", "warn")


def set_tile(slug: str, raw: str) -> None:
    """Handle a `::tile:: ...` line: plain text, JSON {"text", "tone"}, or empty to clear."""
    raw = raw.strip()
    tile = None
    if raw:
        text, tone = raw, ""
        if raw.startswith("{"):
            try:
                obj = json.loads(raw)
                text, tone = str(obj.get("text", "")), str(obj.get("tone", ""))
            except (ValueError, AttributeError):
                pass
        text = text.strip()[:60]
        if text:
            tile = {"text": text, "tone": tone if tone in TONES else "", "t": db.now_iso()}
    db.execute("UPDATE services SET tile=? WHERE slug=?", (json.dumps(tile) if tile else "", slug))
    bus.publish({"type": "status", "slug": slug})


async def _stream_proc(proc: asyncio.subprocess.Process, buf: LogBuffer, slug: str | None = None) -> None:
    async def pump(reader: asyncio.StreamReader | None, name: str) -> None:
        if reader is None:
            return
        while True:
            try:
                line = await reader.readline()
            except ValueError:  # line longer than limit
                line = await reader.read(65536)
            if not line:
                break
            text = line.decode("utf-8", errors="replace")
            if slug and name == "out" and text.startswith(TILE_PREFIX):
                set_tile(slug, text[len(TILE_PREFIX):])
            buf.write(name, text)

    await asyncio.gather(pump(proc.stdout, "out"), pump(proc.stderr, "err"))


async def _run_cmd(cmd: list[str], buf: LogBuffer, cwd: Path, env: dict | None = None) -> int:
    buf.write("sys", "$ " + " ".join(cmd))
    proc = await asyncio.create_subprocess_exec(
        *cmd, cwd=str(cwd), env=env or os.environ.copy(),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, limit=1024 * 1024,
    )
    await _stream_proc(proc, buf)
    return await proc.wait()


_venv_locks: dict[str, asyncio.Lock] = {}


async def ensure_venv(service: dict, buf: LogBuffer) -> Path:
    """Create the service's venv and install requirements.txt when it changes. Returns python path."""
    slug = service["slug"]
    lock = _venv_locks.setdefault(slug, asyncio.Lock())
    async with lock:
        vdir = files.venv_dir(slug)
        py = vdir / "bin" / "python"
        code = files.code_dir(slug)
        env = os.environ.copy()
        env["UV_CACHE_DIR"] = str(config.CACHE_DIR / "uv")
        env["UV_LINK_MODE"] = "copy"
        env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
        uv = uv_bin()
        pymark = vdir / ".servicehub-python"
        if py.exists() and (not pymark.exists() or pymark.read_text() != sys.version):
            buf.write("sys", "Python changed since this environment was built; rebuilding it…")
            shutil.rmtree(vdir, ignore_errors=True)
        if not py.exists():
            buf.write("sys", "Creating a Python environment for this service…")
            cmd = [uv, "venv", "--quiet", "--python", base_python(), str(vdir)] if uv else [base_python(), "-m", "venv", str(vdir)]
            rc = await _run_cmd(cmd, buf, code, env)
            if rc != 0:
                raise RuntimeError("Couldn't create the Python environment")
            pymark.write_text(sys.version)
        req = code / "requirements.txt"
        req_text = req.read_text() if req.exists() else ""
        stripped = "\n".join(l for l in req_text.splitlines() if l.strip() and not l.strip().startswith("#"))
        want = hashlib.sha256((stripped + "|" + sys.version).encode()).hexdigest()
        marker = vdir / ".servicehub-requirements"
        have = marker.read_text() if marker.exists() else ""
        if stripped and want != have:
            buf.write("sys", "requirements.txt changed; installing packages…")
            if uv:
                cmd = [uv, "pip", "install", "--python", str(py), "-r", str(req)]
            else:
                cmd = [str(py), "-m", "pip", "install", "-r", str(req)]
            rc = await _run_cmd(cmd, buf, code, env)
            if rc != 0:
                raise RuntimeError("Installing requirements failed (see the log above)")
            marker.write_text(want)
            buf.write("sys", "Packages installed.")
        elif not stripped and have:
            marker.unlink(missing_ok=True)
        return py


def service_env(service: dict, extra: dict | None = None) -> dict:
    slug = service["slug"]
    data = files.appdata_dir(slug)
    data.mkdir(parents=True, exist_ok=True)
    env = {k: v for k, v in os.environ.items() if not k.startswith("SERVICEHUB_") and not k.startswith("PUSHOVER_")}
    env.update({
        "PYTHONUNBUFFERED": "1",
        "DATA_DIR": str(data),
        "SERVICEHUB_SERVICE": slug,
        "SERVICEHUB_BASE_PATH": f"/s/{slug}",
        "VIRTUAL_ENV": str(files.venv_dir(slug)),
        "PATH": f"{files.venv_dir(slug)}/bin:" + os.environ.get("PATH", ""),
    })
    # Shared secrets first, so a service's own env var of the same name wins.
    names = service.get("secrets") or []
    if names:
        marks = ",".join("?" * len(names))
        for row in db.query(f"SELECT name, value FROM secrets WHERE name IN ({marks})", tuple(names)):
            env[row["name"]] = row["value"]
    for k, v in (service.get("env") or {}).items():
        if k:
            env[str(k)] = str(v)
    if extra:
        env.update(extra)
    return env


async def _terminate(proc: asyncio.subprocess.Process, grace: float = 10) -> None:
    if proc.returncode is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        await asyncio.wait_for(proc.wait(), grace)
    except asyncio.TimeoutError:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        await proc.wait()


async def _spawn(service: dict, py: Path, extra_env: dict | None = None) -> asyncio.subprocess.Process:
    entry = files.safe_path(service["slug"], service["entrypoint"] or "main.py")
    if not entry.exists():
        raise RuntimeError(f"Entrypoint {service['entrypoint']} doesn't exist. Add it in the Code tab or change it in Settings.")
    return await asyncio.create_subprocess_exec(
        str(py), "-u", str(entry),
        cwd=str(files.code_dir(service["slug"])), env=service_env(service, extra_env),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        start_new_session=True, limit=1024 * 1024,
    )


# ---- supervised processes (worker, webapp) -----------------------------------

class Supervisor:
    def __init__(self, slug: str) -> None:
        self.slug = slug
        self.state = "stopped"  # stopped | installing | starting | running | backoff | failed
        self.detail = ""
        self.proc: asyncio.subprocess.Process | None = None
        self.task: asyncio.Task | None = None
        self.started_at: float | None = None
        self.crashes: deque[float] = deque()
        self.restarts = 0
        self.last_exit: int | None = None
        self.want_running = False
        self.buf = LogBuffer(files.logs_dir(slug) / "process.log")
        if not self.buf.lines:
            for e in read_log_file(self.buf.path, 300):
                self.buf.lines.append(e)
        self.notified_failure = False

    def _set(self, state: str, detail: str = "") -> None:
        self.state, self.detail = state, detail
        bus.publish({"type": "status", "slug": self.slug})

    async def start(self) -> None:
        self.want_running = True
        if self.task and not self.task.done():
            return
        self.crashes.clear()
        self.task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        self.want_running = False
        if self.proc and self.proc.returncode is None:
            self.buf.write("sys", "Stopping…")
            await _terminate(self.proc)
        if self.task and not self.task.done():
            self.task.cancel()
            try:
                await self.task
            except (asyncio.CancelledError, Exception):
                pass
        self.task = None
        self.proc = None
        self.started_at = None
        self._set("stopped")

    async def restart(self) -> None:
        await self.stop()
        await self.start()

    async def _wait_port(self, port: int, timeout: float = 60) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.proc is None or self.proc.returncode is not None:
                return False
            try:
                _, w = await asyncio.open_connection("127.0.0.1", port)
                w.close()
                return True
            except OSError:
                await asyncio.sleep(0.4)
        return False

    async def _loop(self) -> None:
        backoff = 1.0
        while self.want_running:
            service = get_service(self.slug)
            if not service:
                return
            try:
                self._set("installing", "Preparing environment")
                py = await ensure_venv(service, self.buf)
                extra = {}
                if service["type"] == "webapp":
                    port = app_port(service)
                    extra = {"PORT": str(port), "HOST": "127.0.0.1"}
                self._set("starting")
                self.buf.write("sys", f"Starting {service['entrypoint']}" + (f" on port {extra['PORT']}" if extra else ""))
                self.proc = await _spawn(service, py, extra)
                self.started_at = spawned = time.time()
                pump = asyncio.create_task(_stream_proc(self.proc, self.buf, self.slug))
                if service["type"] == "webapp":
                    ok = await self._wait_port(int(extra["PORT"]))
                    if ok:
                        self._set("running")
                        self.buf.write("sys", "Listening; ready at /s/" + self.slug + "/")
                    elif self.proc.returncode is None:
                        self._set("running", f"Not listening on port {extra['PORT']} yet")
                        self.buf.write("sys", f"Still not listening on $PORT ({extra['PORT']}). Make sure the app binds to it.")
                else:
                    self._set("running")
                rc = await self.proc.wait()
                await pump
                self.last_exit = rc
                self.proc = None
                self.started_at = None
                if not self.want_running:
                    break
                self.buf.write("sys", f"Process exited with code {rc}")
                if time.time() - spawned > CRASH_WINDOW:
                    backoff = 1.0  # it ran fine for a while; treat this as a fresh failure
                    self.crashes.clear()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self.buf.write("sys", f"Error: {e}")
                self.last_exit = None
            if not self.want_running:
                break
            now = time.time()
            self.crashes.append(now)
            while self.crashes and now - self.crashes[0] > CRASH_WINDOW:
                self.crashes.popleft()
            if len(self.crashes) >= CRASH_LIMIT:
                msg = f"Crashed {len(self.crashes)} times in {CRASH_WINDOW // 60} minutes, so ServiceHub stopped restarting it."
                self.buf.write("sys", msg)
                self.want_running = False
                self._set("failed", msg)
                await _notify_failure(service, f"{service['name']} keeps crashing", msg + self._tail())
                self.notified_failure = True
                return
            self.restarts += 1
            self._set("backoff", f"Restarting in {int(backoff)}s")
            self.buf.write("sys", f"Restarting in {int(backoff)}s…")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)
        self._set("stopped")

    def _tail(self, n: int = 8) -> str:
        lines = [e["l"] for e in list(self.buf.lines)[-n:] if e["s"] != "sys"]
        return ("\n\n" + "\n".join(lines)) if lines else ""

    def info(self) -> dict:
        return {
            "state": self.state,
            "detail": self.detail,
            "pid": self.proc.pid if self.proc and self.proc.returncode is None else None,
            "started_at": datetime.fromtimestamp(self.started_at, timezone.utc).isoformat().replace("+00:00", "Z") if self.started_at else None,
            "restarts": self.restarts,
            "last_exit": self.last_exit,
        }


supervisors: dict[str, Supervisor] = {}


def supervisor(slug: str) -> Supervisor:
    if slug not in supervisors:
        supervisors[slug] = Supervisor(slug)
    return supervisors[slug]


# ---- script runs -------------------------------------------------------------

class ActiveRun:
    def __init__(self, run_id: int, slug: str) -> None:
        self.run_id = run_id
        self.slug = slug
        self.buf = LogBuffer(files.logs_dir(slug) / f"run-{run_id}.log", max_file_bytes=20 * 1024 * 1024)
        self.proc: asyncio.subprocess.Process | None = None
        self.cancelled = False
        self.task: asyncio.Task | None = None


active_runs: dict[int, ActiveRun] = {}


def running_run_for(service_id: int) -> int | None:
    for rid, r in active_runs.items():
        row = db.one("SELECT service_id FROM runs WHERE id=?", (rid,))
        if row and row["service_id"] == service_id:
            return rid
    return None


def _input_env(service: dict, inputs: dict) -> dict:
    env = {"SERVICEHUB_INPUTS": json.dumps(inputs)}
    for k, v in inputs.items():
        key = "INPUT_" + "".join(c if c.isalnum() else "_" for c in str(k)).upper()
        env[key] = "true" if v is True else "false" if v is False else str(v)
    return env


def clean_inputs(service: dict, raw: dict) -> dict:
    out: dict[str, Any] = {}
    for spec in service.get("inputs") or []:
        name = spec.get("name")
        if not name:
            continue
        val = raw.get(name, spec.get("default", ""))
        t = spec.get("type", "text")
        if t == "password" and val in ("", None):
            # The launcher never sees password defaults, so a blank field means "use the default".
            val = spec.get("default", "")
        if t == "checkbox":
            val = val in (True, "true", "1", 1, "on")
        elif t == "number":
            if val in ("", None):
                val = ""
            else:
                try:
                    f = float(val)
                    val = int(f) if f.is_integer() else f
                except (TypeError, ValueError):
                    raise ValueError(f"{spec.get('label') or name} must be a number")
        else:
            val = "" if val is None else str(val)
        if spec.get("required") and val in ("", None):
            raise ValueError(f"{spec.get('label') or name} is required")
        out[name] = val
    return out


async def start_run(service: dict, trigger: str, inputs: dict | None = None, extra_env: dict | None = None) -> int:
    if service["type"] != "script":
        raise ValueError("Only scripts can be run")
    existing = running_run_for(service["id"])
    if existing:
        raise RuntimeError("This script is already running")
    inputs = clean_inputs(service, inputs or {})
    rid = db.execute(
        "INSERT INTO runs(service_id, trigger, status, inputs, started_at) VALUES(?,?,?,?,?)",
        (service["id"], trigger, "running", json.dumps(inputs), db.now_iso()),
    )
    run = ActiveRun(rid, service["slug"])
    active_runs[rid] = run
    env = {"SERVICEHUB_TRIGGER": trigger} | (extra_env or {})
    run.task = asyncio.create_task(_execute_run(service, run, inputs, env))
    bus.publish({"type": "run", "slug": service["slug"], "run_id": rid, "status": "running"})
    return rid


async def _execute_run(service: dict, run: ActiveRun, inputs: dict, extra_env: dict | None = None) -> None:
    t0 = time.time()
    status, rc = "failed", None
    try:
        run.buf.write("sys", f"Run #{run.run_id} started")
        py = await ensure_venv(service, run.buf)
        run.proc = await _spawn(service, py, _input_env(service, inputs) | (extra_env or {}))
        pump = asyncio.create_task(_stream_proc(run.proc, run.buf, service["slug"]))
        timeout = service.get("timeout_seconds") or None
        try:
            rc = await asyncio.wait_for(run.proc.wait(), timeout)
            await pump
            status = "success" if rc == 0 else "failed"
        except asyncio.TimeoutError:
            run.buf.write("sys", f"Timed out after {timeout}s; stopping it.")
            await _terminate(run.proc, 5)
            await pump
            rc = run.proc.returncode
            status = "timeout"
        if run.cancelled:
            status = "cancelled"
    except Exception as e:
        run.buf.write("sys", f"Error: {e}")
        status = "failed"
    finally:
        dur = int((time.time() - t0) * 1000)
        run.buf.write("sys", f"Finished: {status}" + (f" (exit code {rc})" if rc is not None else "") + f" in {dur / 1000:.1f}s")
        db.execute(
            "UPDATE runs SET status=?, exit_code=?, finished_at=?, duration_ms=? WHERE id=?",
            (status, rc, db.now_iso(), dur, run.run_id),
        )
        run.buf.close()
        active_runs.pop(run.run_id, None)
        bus.publish({"type": "run", "slug": service["slug"], "run_id": run.run_id, "status": status})
        bus.publish({"type": "status", "slug": service["slug"]})
        await _after_run_notify(service, run, status)
        prune_runs(service)


async def cancel_run(run_id: int) -> bool:
    run = active_runs.get(run_id)
    if not run or not run.proc:
        return False
    run.cancelled = True
    run.buf.write("sys", "Cancelling…")
    await _terminate(run.proc, 5)
    return True


def prune_runs(service: dict) -> None:
    old = db.query(
        "SELECT id FROM runs WHERE service_id=? ORDER BY id DESC LIMIT -1 OFFSET ?",
        (service["id"], config.MAX_RUNS_PER_SERVICE),
    )
    for r in old:
        (files.logs_dir(service["slug"]) / f"run-{r['id']}.log").unlink(missing_ok=True)
        db.execute("DELETE FROM runs WHERE id=?", (r["id"],))


async def _notify_failure(service: dict, title: str, message: str) -> None:
    if not service.get("notify_on_failure"):
        return
    ok, info = await notify.send(title, message, priority=0, url=f"/admin/services/{service['slug']}")
    if not ok:
        log.info("notification not sent: %s", info)


async def _after_run_notify(service: dict, run: ActiveRun, status: str) -> None:
    """Notify on the first failure in a streak and again when it recovers."""
    prev = db.one(
        "SELECT status FROM runs WHERE service_id=? AND id<? AND status!='running' ORDER BY id DESC LIMIT 1",
        (service["id"], run.run_id),
    )
    prev_failed = bool(prev and prev["status"] in ("failed", "timeout"))
    if status in ("failed", "timeout") and not prev_failed:
        tail = "\n".join(e["l"] for e in list(run.buf.lines)[-10:] if e["s"] != "sys")
        await _notify_failure(service, f"{service['name']} failed", f"Run #{run.run_id} {status}." + (f"\n\n{tail}" if tail else ""))
    elif status == "success" and prev_failed:
        await _notify_failure(service, f"{service['name']} recovered", f"Run #{run.run_id} succeeded after failing.")


# ---- scheduler -----------------------------------------------------------------

def next_runs(expr: str, n: int = 5, start: datetime | None = None) -> list[datetime]:
    base = start or datetime.now(config.TZ)
    it = croniter(expr, base)
    return [it.get_next(datetime) for _ in range(n)]


def valid_cron(expr: str) -> bool:
    return bool(expr) and croniter.is_valid(expr)


class Scheduler:
    def __init__(self) -> None:
        self.next: dict[str, datetime] = {}
        self.task: asyncio.Task | None = None

    def reload(self) -> None:
        self.next.clear()
        now = datetime.now(config.TZ)
        for row in db.query("SELECT * FROM services WHERE type='script' AND enabled=1 AND schedule!=''"):
            if valid_cron(row["schedule"]):
                self.next[row["slug"]] = next_runs(row["schedule"], 1, now)[0]

    def next_for(self, slug: str) -> str | None:
        t = self.next.get(slug)
        return t.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if t else None

    async def loop(self) -> None:
        self.reload()
        while True:
            await asyncio.sleep(1)
            now = datetime.now(config.TZ)
            for slug, t in list(self.next.items()):
                if now < t:
                    continue
                service = get_service(slug)
                if not service or not service["enabled"] or not valid_cron(service["schedule"]):
                    self.next.pop(slug, None)
                    continue
                self.next[slug] = next_runs(service["schedule"], 1, now)[0]
                bus.publish({"type": "status", "slug": slug})
                try:
                    await start_run(service, "schedule")
                except RuntimeError:
                    log.info("skipping scheduled run of %s: still running", slug)
                except Exception as e:
                    log.warning("scheduled run of %s failed to start: %s", slug, e)

    def start(self) -> None:
        self.task = asyncio.create_task(self.loop())


scheduler = Scheduler()


# ---- status --------------------------------------------------------------------

def service_status(service: dict) -> dict:
    t = service["type"]
    st: dict[str, Any] = {"state": "unknown", "detail": ""}
    if not service["enabled"]:
        st["state"] = "disabled"
    elif t == "static":
        st["state"] = "up" if files.safe_path(service["slug"], service["entrypoint"] or "index.html").exists() else "unknown"
        if st["state"] == "unknown":
            st["detail"] = "No index file yet"
    elif t == "script":
        rid = running_run_for(service["id"])
        last = db.one(
            "SELECT id, status, finished_at, started_at, duration_ms FROM runs WHERE service_id=? AND status!='running' ORDER BY id DESC LIMIT 1",
            (service["id"],),
        )
        st["last_run"] = last
        st["running_run"] = rid
        st["next_run"] = scheduler.next_for(service["slug"])
        if rid:
            st["state"] = "running"
        elif not last:
            st["state"] = "idle"
        else:
            st["state"] = "failing" if last["status"] in ("failed", "timeout") else "ok"
    else:
        info = supervisor(service["slug"]).info()
        st.update(info)
        if t == "webapp":
            st["port"] = app_port(service)
    st["dirty"] = bool(service.get("deployed_hash")) and files.tree_hash(service["slug"]) != service["deployed_hash"]
    return st


# ---- lifecycle -----------------------------------------------------------------

async def apply_service(service: dict) -> None:
    """Bring processes in line with the service's config (after create/update/deploy)."""
    if service["type"] in ("worker", "webapp"):
        sup = supervisor(service["slug"])
        if service["enabled"]:
            await sup.restart()
        else:
            await sup.stop()
    else:
        if service["slug"] in supervisors:
            await supervisors[service["slug"]].stop()
    scheduler.reload()
    bus.publish({"type": "status", "slug": service["slug"]})


async def startup() -> None:
    db.execute("UPDATE runs SET status='interrupted', finished_at=? WHERE status='running'", (db.now_iso(),))
    for row in db.query("SELECT * FROM services WHERE type IN ('worker','webapp') AND enabled=1"):
        await supervisor(row["slug"]).start()
    scheduler.start()


async def shutdown() -> None:
    for sup in list(supervisors.values()):
        await sup.stop()
    for run in list(active_runs.values()):
        await cancel_run(run.run_id)
