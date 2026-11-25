import asyncio
import hmac
import json
import re
import secrets as pysecrets
from datetime import datetime

from cron_descriptor import ExpressionDescriptor, Options
from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import auth, config, db, files, notify, runner, templates

router = APIRouter(prefix="/api")
hooks = APIRouter()
ENV_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

TYPES = ("static", "script", "worker", "webapp")
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,47}$")
INPUT_TYPES = ("text", "textarea", "number", "select", "checkbox", "password")


def err(status: int, msg: str):
    raise HTTPException(status_code=status, detail=msg)


def need(slug: str) -> dict:
    s = runner.get_service(slug)
    if not s:
        err(404, f"No service called {slug}")
    return s


def need_access(request: Request, slug: str) -> dict:
    """The service, if this visitor is admin or has unlocked it (or it has no password)."""
    s = need(slug)
    if not auth.has_service_access(request, slug):
        err(403, "This service needs its password.")
    return s


def mask_inputs(service: dict | None, values: dict) -> dict:
    """Hide password-type input values from people who aren't signed in to admin mode."""
    secret = {i["name"] for i in (service or {}).get("inputs") or [] if i.get("type") == "password"}
    return {k: ("••••" if k in secret and v not in ("", None) else v) for k, v in values.items()}


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:48]
    return s or "service"


def unique_slug(base: str) -> str:
    slug, n = base, 2
    while db.one("SELECT id FROM services WHERE slug=?", (slug,)):
        slug = f"{base[:44]}-{n}"
        n += 1
    return slug


def public(service: dict) -> dict:
    d = dict(service)
    d["status"] = runner.service_status(service)
    return d


def launcher_view(service: dict, request: Request) -> dict:
    """What the launcher needs: no env values, and no password-input defaults unless you're admin."""
    admin = auth.is_authed(request)
    unlocked = auth.has_service_access(request, service["slug"])
    inputs = service["inputs"] if unlocked else []
    if not admin:
        inputs = [i | {"default": ""} if i.get("type") == "password" else i for i in inputs]
    return {
        k: service[k] for k in ("id", "slug", "name", "description", "type", "icon", "group_id", "position", "enabled")
    } | {"inputs": inputs, "has_password": service["has_password"], "locked": not unlocked, "tile": service["tile"],
         "status": runner.service_status(service)}


# ---- auth ----------------------------------------------------------------------

class LoginBody(BaseModel):
    password: str


@router.get("/auth/status")
def auth_status(request: Request):
    return {"enabled": auth.enabled(), "authed": auth.is_authed(request), "version": config.VERSION}


@router.post("/auth/login")
async def login(body: LoginBody):
    if not auth.enabled():
        return {"ok": True}
    if not auth.check_password(body.password):
        await asyncio.sleep(1)
        err(401, "That password isn't right.")
    resp = JSONResponse({"ok": True})
    resp.set_cookie(auth.COOKIE, auth.make_session(), max_age=auth.SESSION_SECONDS, httponly=True, samesite="lax")
    return resp


@router.post("/auth/logout")
def logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(auth.COOKIE)
    return resp


@router.post("/services/{slug}/unlock")
async def unlock(slug: str, body: LoginBody):
    s = need(slug)
    stored = auth.service_hash(slug)
    if stored and not auth.verify_password(body.password, stored):
        await asyncio.sleep(1)
        err(403, "That password isn't right.")
    resp = JSONResponse({"ok": True, "name": s["name"]})
    if stored:
        resp.set_cookie(auth.service_cookie(slug), auth.make_service_session(slug),
                        max_age=auth.SESSION_SECONDS, httponly=True, samesite="lax")
    return resp


@router.post("/services/{slug}/lock")
def lock(slug: str):
    need(slug)
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(auth.service_cookie(slug))
    return resp


@router.get("/services/{slug}/unlock")
def unlock_info(slug: str, request: Request):
    s = need(slug)
    return {"name": s["name"], "icon": s["icon"], "type": s["type"], "locked": not auth.has_service_access(request, slug)}


# ---- launcher ------------------------------------------------------------------

@router.get("/launcher")
def launcher(request: Request):
    groups = db.query("SELECT * FROM groups ORDER BY position, id")
    services = [
        launcher_view(db.service_row_to_dict(r), request)
        for r in db.query("SELECT * FROM services WHERE show_on_launcher=1 ORDER BY position, name")
    ]
    return {"groups": groups, "services": services, "admin": auth.is_authed(request)}


# ---- groups --------------------------------------------------------------------

class GroupBody(BaseModel):
    name: str = Field(min_length=1, max_length=60)


@router.get("/groups")
def list_groups():
    return db.query("SELECT * FROM groups ORDER BY position, id")


@router.post("/groups")
def create_group(body: GroupBody):
    pos = (db.one("SELECT MAX(position) AS p FROM groups")["p"] or 0) + 1
    gid = db.execute("INSERT INTO groups(name, position) VALUES(?, ?)", (body.name.strip(), pos))
    runner.bus.publish({"type": "layout"})
    return db.one("SELECT * FROM groups WHERE id=?", (gid,))


@router.patch("/groups/{gid}")
def rename_group(gid: int, body: GroupBody):
    db.execute("UPDATE groups SET name=? WHERE id=?", (body.name.strip(), gid))
    runner.bus.publish({"type": "layout"})
    return db.one("SELECT * FROM groups WHERE id=?", (gid,))


@router.delete("/groups/{gid}")
def delete_group(gid: int):
    db.execute("UPDATE services SET group_id=NULL WHERE group_id=?", (gid,))
    db.execute("DELETE FROM groups WHERE id=?", (gid,))
    runner.bus.publish({"type": "layout"})
    return {"ok": True}


class LayoutBody(BaseModel):
    groups: list[int]
    # group id (or "none") → ordered service ids
    services: dict[str, list[int]]


@router.put("/layout")
def save_layout(body: LayoutBody):
    for i, gid in enumerate(body.groups):
        db.execute("UPDATE groups SET position=? WHERE id=?", (i, gid))
    for key, ids in body.services.items():
        gid = None if key in ("none", "null", "") else int(key)
        for i, sid in enumerate(ids):
            db.execute("UPDATE services SET group_id=?, position=? WHERE id=?", (gid, i, sid))
    runner.bus.publish({"type": "layout"})
    return {"ok": True}


# ---- services ------------------------------------------------------------------

@router.get("/services")
def list_services():
    return [public(db.service_row_to_dict(r)) for r in db.query("SELECT * FROM services ORDER BY name")]


class CreateBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    type: str
    slug: str | None = None
    description: str = ""
    icon: str = ""
    group_id: int | None = None
    template: bool = True


def create_service_row(name: str, kind: str, slug: str | None, description: str = "", icon: str = "",
                       group_id: int | None = None, entrypoint: str | None = None) -> dict:
    if kind not in TYPES:
        err(400, f"Type must be one of: {', '.join(TYPES)}")
    slug = (slug or "").strip().lower() or unique_slug(slugify(name))
    if not SLUG_RE.match(slug):
        err(400, "The URL name can only use lowercase letters, numbers and dashes (like tip-calc).")
    if db.one("SELECT id FROM services WHERE slug=?", (slug,)):
        err(409, f"A service called {slug} already exists.")
    now = db.now_iso()
    pos = (db.one("SELECT MAX(position) AS p FROM services WHERE group_id IS ?", (group_id,))["p"] or 0) + 1
    sid = db.execute(
        """INSERT INTO services(slug, name, description, type, icon, group_id, position, entrypoint, inputs,
           show_on_launcher, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
        (slug, name.strip(), description, kind, icon, group_id, pos,
         entrypoint or templates.DEFAULT_ENTRY[kind], json.dumps(templates.starter_inputs(kind)),
         1, now, now),
    )
    files.code_dir(slug).mkdir(parents=True, exist_ok=True)
    return runner.get_service_by_id(sid)


@router.post("/services")
async def create_service(body: CreateBody):
    s = create_service_row(body.name, body.type, body.slug, body.description, body.icon, body.group_id)
    if body.template:
        for path, content in templates.starter_files(s["type"], s["name"], s["slug"]).items():
            files.write_file(s["slug"], path, content.encode())
    else:
        db.execute("UPDATE services SET inputs='[]' WHERE id=?", (s["id"],))
    s = runner.get_service(s["slug"])
    files.snapshot(s, "Created", "create")
    s = runner.get_service(s["slug"])
    if s["type"] in ("worker", "webapp") and body.template:
        await runner.apply_service(s)
    runner.bus.publish({"type": "layout"})
    return public(runner.get_service(s["slug"]))


@router.get("/services/{slug}")
def get_service(slug: str):
    return public(need(slug))


class InputSpec(BaseModel):
    name: str
    label: str = ""
    type: str = "text"
    default: str | int | float | bool | None = ""
    required: bool = False
    help: str = ""
    options: list[str] = []


class UpdateBody(BaseModel):
    name: str | None = None
    description: str | None = None
    icon: str | None = None
    type: str | None = None
    group_id: int | None = None
    show_on_launcher: bool | None = None
    enabled: bool | None = None
    entrypoint: str | None = None
    schedule: str | None = None
    timeout_seconds: int | None = None
    inputs: list[InputSpec] | None = None
    env: dict[str, str] | None = None
    notify_on_failure: bool | None = None
    # "" removes the password; any other value sets it
    access_password: str | None = None
    secrets: list[str] | None = None


@router.patch("/services/{slug}")
async def update_service(slug: str, body: UpdateBody):
    s = need(slug)
    data = body.model_dump(exclude_unset=True)
    restart_keys = {"type", "enabled", "entrypoint", "env", "secrets"}
    sets, vals = [], []
    if "access_password" in data:
        pw = data.pop("access_password") or ""
        data["access_hash"] = auth.hash_password(pw) if pw else ""
    for k, v in data.items():
        if k == "type" and v not in TYPES:
            err(400, "Unknown service type")
        if k == "schedule":
            v = (v or "").strip()
            if v and not runner.valid_cron(v):
                err(400, "That schedule isn't a valid cron expression.")
        if k == "entrypoint":
            v = files.clean_rel(v or "")
        if k == "inputs":
            names = set()
            for spec in v:
                if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", spec["name"]):
                    err(400, f"Input name {spec['name']!r} should be letters, numbers and underscores.")
                if spec["name"] in names:
                    err(400, f"Two inputs are called {spec['name']}.")
                if spec["type"] not in INPUT_TYPES:
                    err(400, f"Unknown input type {spec['type']}")
                names.add(spec["name"])
            v = json.dumps(v)
        if k == "env":
            for key in v:
                if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key):
                    err(400, f"{key!r} isn't a valid environment variable name.")
            v = json.dumps(v)
        if k == "secrets":
            known = {r["name"] for r in db.query("SELECT name FROM secrets")}
            missing = [n for n in v if n not in known]
            if missing:
                err(400, f"No shared secret called {missing[0]}.")
            v = json.dumps(sorted(set(v)))
        if k == "timeout_seconds":
            v = max(0, int(v or 0))
        if k == "name" and not (v or "").strip():
            err(400, "Name can't be empty")
        if isinstance(v, bool):
            v = int(v)
        sets.append(f"{k}=?")
        vals.append(v)
    if sets:
        sets.append("updated_at=?")
        vals.append(db.now_iso())
        db.execute(f"UPDATE services SET {', '.join(sets)} WHERE id=?", (*vals, s["id"]))
    s2 = need(slug)
    if restart_keys & data.keys():
        changed = any(s.get(k) != s2.get(k) for k in restart_keys)
        if changed:
            await runner.apply_service(s2)
    runner.scheduler.reload()
    runner.bus.publish({"type": "status", "slug": slug})
    runner.bus.publish({"type": "layout"})
    return public(s2)


@router.delete("/services/{slug}")
async def delete_service(slug: str):
    s = need(slug)
    if slug in runner.supervisors:
        await runner.supervisors.pop(slug).stop()
    rid = runner.running_run_for(s["id"])
    if rid:
        await runner.cancel_run(rid)
    db.execute("DELETE FROM runs WHERE service_id=?", (s["id"],))
    db.execute("DELETE FROM versions WHERE service_id=?", (s["id"],))
    db.execute("DELETE FROM services WHERE id=?", (s["id"],))
    files.remove_all(slug)
    runner.scheduler.reload()
    runner.bus.publish({"type": "layout"})
    return {"ok": True}


# ---- control -------------------------------------------------------------------

@router.post("/services/{slug}/start")
async def start(slug: str, request: Request):
    s = need_access(request, slug)
    if s["type"] not in ("worker", "webapp"):
        err(400, "Only workers and web apps can be started")
    if not s["enabled"]:
        err(400, "This service is disabled. Enable it in Settings first.")
    await runner.supervisor(slug).start()
    return {"ok": True}


@router.post("/services/{slug}/stop")
async def stop(slug: str, request: Request):
    s = need_access(request, slug)
    if s["type"] == "script":
        rid = runner.running_run_for(s["id"])
        if rid:
            await runner.cancel_run(rid)
    else:
        await runner.supervisor(slug).stop()
    return {"ok": True}


@router.post("/services/{slug}/restart")
async def restart(slug: str, request: Request):
    s = need_access(request, slug)
    if s["type"] not in ("worker", "webapp"):
        err(400, "Only workers and web apps can be restarted")
    await runner.supervisor(slug).restart()
    return {"ok": True}


class RunBody(BaseModel):
    inputs: dict = {}


@router.post("/services/{slug}/run")
async def run(slug: str, body: RunBody, request: Request):
    s = need_access(request, slug)
    if not s["enabled"]:
        err(400, "This script is disabled.")
    try:
        rid = await runner.start_run(s, "api" if auth.is_token_request(request) else "manual", body.inputs)
    except ValueError as e:
        err(400, str(e))
    except RuntimeError as e:
        err(409, str(e))
    return {"run_id": rid}


# ---- logs ------------------------------------------------------------------------

def _sse(data: dict | None, event: str | None = None) -> str:
    out = f"event: {event}\n" if event else ""
    return out + f"data: {json.dumps(data)}\n\n"


async def _stream_buffer(request: Request, buf: runner.LogBuffer, history: list[dict], ended: bool):
    q = None if ended else buf.subscribe()
    try:
        yield _sse({"lines": history}, "history")
        if ended:
            yield _sse({}, "end")
            return
        while True:
            if await request.is_disconnected():
                return
            try:
                entry = await asyncio.wait_for(q.get(), 15)
            except asyncio.TimeoutError:
                yield ": ping\n\n"
                continue
            if entry is None:
                yield _sse({}, "end")
                return
            batch = [entry]
            while not q.empty() and len(batch) < 500:
                e = q.get_nowait()
                if e is None:
                    yield _sse({"lines": batch}, "lines")
                    yield _sse({}, "end")
                    return
                batch.append(e)
            yield _sse({"lines": batch}, "lines")
    finally:
        if q is not None:
            buf.unsubscribe(q)


SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


@router.get("/services/{slug}/logs/stream")
async def process_logs(slug: str, request: Request):
    need_access(request, slug)
    sup = runner.supervisor(slug)
    return StreamingResponse(_stream_buffer(request, sup.buf, list(sup.buf.lines), False),
                             media_type="text/event-stream", headers=SSE_HEADERS)


@router.post("/services/{slug}/logs/clear")
def clear_logs(slug: str):
    need(slug)
    sup = runner.supervisor(slug)
    sup.buf.clear()
    if sup.buf.path and sup.buf.path.exists():
        sup.buf.path.unlink()
    return {"ok": True}


@router.get("/runs")
def all_runs(request: Request, limit: int = Query(100, le=500), slug: str | None = None, status: str | None = None):
    admin = auth.is_authed(request)
    if not admin:
        if not slug:
            err(401, "Sign in first.")
        service = need_access(request, slug)
    sql = "SELECT r.*, s.slug, s.name FROM runs r JOIN services s ON s.id=r.service_id WHERE 1=1"
    params: list = []
    if slug:
        sql += " AND s.slug=?"
        params.append(slug)
    if status:
        sql += " AND r.status=?"
        params.append(status)
    sql += " ORDER BY r.id DESC LIMIT ?"
    params.append(limit)
    rows = db.query(sql, tuple(params))
    for r in rows:
        r["inputs"] = json.loads(r["inputs"] or "{}")
        if not admin:
            r["inputs"] = mask_inputs(service, r["inputs"])
    return rows


@router.get("/runs/{rid}")
def get_run(rid: int, request: Request):
    r = db.one("SELECT r.*, s.slug, s.name FROM runs r JOIN services s ON s.id=r.service_id WHERE r.id=?", (rid,))
    if not r:
        err(404, "No such run")
    service = need_access(request, r["slug"])
    r["inputs"] = json.loads(r["inputs"] or "{}")
    if not auth.is_authed(request):
        r["inputs"] = mask_inputs(service, r["inputs"])
    return r


@router.get("/runs/{rid}/stream")
async def run_stream(rid: int, request: Request):
    r = get_run(rid, request)
    active = runner.active_runs.get(rid)
    if active:
        return StreamingResponse(_stream_buffer(request, active.buf, list(active.buf.lines), False),
                                 media_type="text/event-stream", headers=SSE_HEADERS)
    lines = runner.read_log_file(files.logs_dir(r["slug"]) / f"run-{rid}.log")
    return StreamingResponse(_stream_buffer(request, runner.LogBuffer(None), lines, True),
                             media_type="text/event-stream", headers=SSE_HEADERS)


@router.post("/runs/{rid}/cancel")
async def cancel(rid: int, request: Request):
    get_run(rid, request)
    if not await runner.cancel_run(rid):
        err(409, "That run isn't running")
    return {"ok": True}


@router.get("/events")
async def events(request: Request):
    async def gen():
        q = runner.bus.subscribe()
        try:
            yield _sse({"type": "hello"})
            while True:
                if await request.is_disconnected():
                    return
                try:
                    e = await asyncio.wait_for(q.get(), 15)
                    yield _sse(e)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            runner.bus.unsubscribe(q)

    return StreamingResponse(gen(), media_type="text/event-stream", headers=SSE_HEADERS)


# ---- files -------------------------------------------------------------------------

@router.get("/services/{slug}/files")
def list_files(slug: str):
    need(slug)
    return files.list_files(slug)


@router.get("/services/{slug}/file")
def read_file(slug: str, path: str):
    need(slug)
    try:
        text, binary = files.read_file(slug, path)
    except FileNotFoundError:
        err(404, f"{path} doesn't exist")
    except files.FileError as e:
        err(400, str(e))
    return {"path": files.clean_rel(path), "content": text, "binary": binary}


class WriteBody(BaseModel):
    path: str
    content: str


@router.put("/services/{slug}/file")
def write_file(slug: str, body: WriteBody):
    need(slug)
    try:
        files.write_file(slug, body.path, body.content.encode())
    except files.FileError as e:
        err(400, str(e))
    runner.bus.publish({"type": "status", "slug": slug})
    return {"ok": True}


@router.get("/services/{slug}/raw")
def raw_file(slug: str, path: str):
    need(slug)
    try:
        p = files.safe_path(slug, path)
    except files.FileError as e:
        err(400, str(e))
    if not p.is_file():
        err(404, "Not found")
    return FileResponse(p, filename=p.name)


@router.delete("/services/{slug}/file")
def delete_file(slug: str, path: str):
    need(slug)
    try:
        files.delete_file(slug, path)
    except files.FileError as e:
        err(400, str(e))
    runner.bus.publish({"type": "status", "slug": slug})
    return {"ok": True}


class RenameBody(BaseModel):
    src: str
    dst: str


@router.post("/services/{slug}/file/rename")
def rename_file(slug: str, body: RenameBody):
    need(slug)
    try:
        files.rename_file(slug, body.src, body.dst)
    except FileNotFoundError:
        err(404, f"{body.src} doesn't exist")
    except files.FileError as e:
        err(400, str(e))
    return {"ok": True}


@router.post("/services/{slug}/upload")
async def upload(slug: str, uploads: list[UploadFile] = File(...), paths: str = Form("[]"),
                 replace: bool = Form(False), extract: bool = Form(True)):
    need(slug)
    try:
        rels = json.loads(paths)
    except json.JSONDecodeError:
        rels = []
    written: list[str] = []
    try:
        if replace:
            files.clear_code(slug)
        for i, up in enumerate(uploads):
            data = await up.read()
            name = rels[i] if i < len(rels) and rels[i] else (up.filename or f"upload-{i}")
            if extract and files.is_zip(name, data):
                written += files.extract_zip(slug, data, replace=False)
            else:
                rel = files.clean_rel(name)
                files.write_file(slug, rel, data)
                written.append(rel)
    except files.FileError as e:
        err(400, str(e))
    runner.bus.publish({"type": "status", "slug": slug})
    return {"written": written}


# ---- deploy & versions ------------------------------------------------------------

class DeployBody(BaseModel):
    note: str = ""


@router.post("/services/{slug}/deploy")
async def deploy(slug: str, body: DeployBody):
    s = need(slug)
    v = files.snapshot(s, body.note.strip() or "Deployed from the editor", "editor")
    s = need(slug)
    if s["type"] in ("worker", "webapp") and s["enabled"]:
        await runner.apply_service(s)
    runner.bus.publish({"type": "status", "slug": slug})
    return {"version": v, "service": public(s)}


@router.get("/services/{slug}/versions")
def versions(slug: str):
    s = need(slug)
    return db.query("SELECT * FROM versions WHERE service_id=? ORDER BY number DESC", (s["id"],))


@router.post("/services/{slug}/versions/{number}/restore")
async def restore(slug: str, number: int):
    s = need(slug)
    try:
        files.restore(s, number)
    except files.FileError as e:
        err(404, str(e))
    s = need(slug)
    if s["type"] in ("worker", "webapp") and s["enabled"]:
        await runner.apply_service(s)
    runner.bus.publish({"type": "status", "slug": slug})
    return public(s)


@router.get("/services/{slug}/versions/{number}/download")
def download_version(slug: str, number: int):
    need(slug)
    p = files.version_zip_path(slug, number)
    if not p.exists():
        err(404, "That version is no longer stored")
    return FileResponse(p, filename=f"{slug}-v{number}.zip", media_type="application/zip")


@router.post("/deploy/{slug}")
async def api_deploy(
    slug: str,
    file: list[UploadFile] = File(...),
    type: str | None = Form(None),
    name: str | None = Form(None),
    entrypoint: str | None = Form(None),
    note: str = Form(""),
    replace: bool = Form(True),
):
    """One-shot deploy for curl: creates the service if needed, replaces its code, snapshots, restarts."""
    s = runner.get_service(slug)
    created = False
    if not s:
        if not type:
            err(400, f"{slug} doesn't exist yet. Pass type=static|script|worker|webapp to create it.")
        first = file[0].filename or ""
        guess = entrypoint or (first if first and not first.lower().endswith(".zip") else None)
        s = create_service_row(name or slug.replace("-", " ").title(), type, slug, entrypoint=guess)
        db.execute("UPDATE services SET inputs='[]' WHERE id=?", (s["id"],))
        created = True
    try:
        if replace:
            files.clear_code(slug)
        for up in file:
            data = await up.read()
            fname = up.filename or "upload"
            if files.is_zip(fname, data):
                files.extract_zip(slug, data, replace=False)
            else:
                files.write_file(slug, files.clean_rel(fname), data)
    except files.FileError as e:
        err(400, str(e))
    if entrypoint and not created:
        db.execute("UPDATE services SET entrypoint=? WHERE id=?", (files.clean_rel(entrypoint), s["id"]))
    s = need(slug)
    v = files.snapshot(s, note.strip() or "Deployed via API", "api")
    s = need(slug)
    if s["type"] in ("worker", "webapp") and s["enabled"]:
        await runner.apply_service(s)
    runner.scheduler.reload()
    runner.bus.publish({"type": "layout"})
    return {"created": created, "version": v["number"], "url": f"/s/{slug}/" if s["type"] in ("static", "webapp") else None}


# ---- cron -------------------------------------------------------------------------

@router.get("/cron/preview")
def cron_preview(expr: str):
    expr = expr.strip()
    if not runner.valid_cron(expr):
        return {"valid": False, "error": "Not a valid cron expression. It needs 5 fields: minute hour day month weekday."}
    try:
        opts = Options()
        opts.use_24hour_time_format = False
        desc = ExpressionDescriptor(expr, opts).get_description()
    except Exception:
        desc = ""
    nxt = runner.next_runs(expr, 5)
    return {"valid": True, "description": desc, "next": [d.isoformat() for d in nxt], "tz": config.TZ_NAME}


# ---- settings -----------------------------------------------------------------------

@router.get("/settings")
def get_settings():
    user, token = notify.pushover_creds()
    return {
        "pushover_user": db.get_setting("pushover_user"),
        "pushover_token_set": bool(db.get_setting("pushover_token")),
        "pushover_from_env": bool(not db.get_setting("pushover_user") and user),
        "pushover_configured": bool(user and token),
        "public_url": db.get_setting("public_url"),
        "api_token_hint": db.get_setting("api_token_hint"),
        "api_token_created": db.get_setting("api_token_created"),
        "auth_enabled": auth.enabled(),
        "tz": config.TZ_NAME,
        "data_dir": str(config.DATA_DIR),
        "version": config.VERSION,
        "now": datetime.now(config.TZ).isoformat(),
    }


class SettingsBody(BaseModel):
    pushover_user: str | None = None
    pushover_token: str | None = None
    public_url: str | None = None


@router.patch("/settings")
def patch_settings(body: SettingsBody):
    for k, v in body.model_dump(exclude_unset=True).items():
        if v is None:
            continue
        db.set_setting(k, v.strip())
    return get_settings()


@router.post("/settings/test-notification")
async def test_notification():
    ok, msg = await notify.send("ServiceHub test", "Notifications are working. You'll hear from ServiceHub when something fails.")
    if not ok:
        err(400, msg)
    return {"ok": True}


@router.post("/settings/api-token")
def make_token():
    return {"token": auth.new_api_token(), **get_settings()}


@router.delete("/settings/api-token")
def delete_token():
    auth.revoke_api_token()
    return get_settings()


# ---- shared secrets ------------------------------------------------------------------

def _services_using(name: str) -> list[dict]:
    return [s for s in (db.service_row_to_dict(r) for r in db.query("SELECT * FROM services")) if name in s["secrets"]]


async def _restart_users(name: str) -> None:
    for s in _services_using(name):
        if s["type"] in ("worker", "webapp") and s["enabled"]:
            await runner.apply_service(s)


@router.get("/secrets")
def list_secrets():
    rows = db.query("SELECT name, updated_at FROM secrets ORDER BY name")
    for r in rows:
        r["used_by"] = [{"slug": s["slug"], "name": s["name"]} for s in _services_using(r["name"])]
    return rows


class SecretBody(BaseModel):
    value: str


@router.put("/secrets/{name}")
async def put_secret(name: str, body: SecretBody):
    if not ENV_NAME_RE.match(name):
        err(400, "Use letters, numbers and underscores, like OPENWEATHER_KEY.")
    if name.upper().startswith(("SERVICEHUB_", "PUSHOVER_")):
        err(400, "Names starting with SERVICEHUB_ or PUSHOVER_ are reserved.")
    db.execute(
        "INSERT INTO secrets(name, value, updated_at) VALUES(?,?,?) "
        "ON CONFLICT(name) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
        (name, body.value, db.now_iso()),
    )
    await _restart_users(name)
    return list_secrets()


@router.delete("/secrets/{name}")
async def delete_secret(name: str):
    users = _services_using(name)
    for s in users:
        db.execute("UPDATE services SET secrets=? WHERE id=?", (json.dumps([n for n in s["secrets"] if n != name]), s["id"]))
    db.execute("DELETE FROM secrets WHERE name=?", (name,))
    for s in users:
        if s["type"] in ("worker", "webapp") and s["enabled"]:
            await runner.apply_service(runner.get_service(s["slug"]))
    return list_secrets()


# ---- tiles ---------------------------------------------------------------------------

@router.delete("/services/{slug}/tile")
def clear_tile(slug: str):
    need(slug)
    runner.set_tile(slug, "")
    return {"ok": True}


# ---- webhooks ------------------------------------------------------------------------

@router.post("/services/{slug}/webhook")
def make_webhook(slug: str):
    s = need(slug)
    if s["type"] != "script":
        err(400, "Only scripts have webhooks.")
    db.execute("UPDATE services SET webhook_token=? WHERE id=?", (pysecrets.token_urlsafe(24), s["id"]))
    return public(need(slug))


@router.delete("/services/{slug}/webhook")
def delete_webhook(slug: str):
    s = need(slug)
    db.execute("UPDATE services SET webhook_token='' WHERE id=?", (s["id"],))
    return public(need(slug))


MAX_HOOK_BODY = 64 * 1024


@hooks.api_route("/hooks/{slug}/{token}", methods=["GET", "POST"], include_in_schema=False)
async def run_webhook(slug: str, token: str, request: Request):
    """Run a script from anywhere that can make an HTTP request. The token in the URL is the password."""
    s = runner.get_service(slug)
    if not s or not s.get("webhook_token") or not hmac.compare_digest(token, s["webhook_token"]):
        await asyncio.sleep(0.5)
        return JSONResponse({"ok": False, "detail": "Unknown webhook."}, status_code=404)
    if not s["enabled"]:
        return JSONResponse({"ok": False, "detail": "This script is disabled."}, status_code=409)
    body = await request.body()
    if len(body) > MAX_HOOK_BODY:
        return JSONResponse({"ok": False, "detail": "Body is too large (64 KB max)."}, status_code=413)
    # Inputs: query string, then a JSON object or form body on top.
    inputs: dict = dict(request.query_params)
    ctype = request.headers.get("content-type", "")
    if body and "application/json" in ctype:
        try:
            data = json.loads(body)
        except ValueError:
            return JSONResponse({"ok": False, "detail": "Body isn't valid JSON."}, status_code=400)
        if isinstance(data, dict):
            inputs |= data
    elif body and "application/x-www-form-urlencoded" in ctype:
        form = await request.form()
        inputs |= {k: v for k, v in form.items() if isinstance(v, str)}
    extra = {
        "SERVICEHUB_WEBHOOK_BODY": body.decode("utf-8", errors="replace"),
        "SERVICEHUB_WEBHOOK_METHOD": request.method,
        "SERVICEHUB_WEBHOOK_CONTENT_TYPE": ctype,
    }
    try:
        rid = await runner.start_run(s, "webhook", inputs, extra)
    except ValueError as e:
        return JSONResponse({"ok": False, "detail": str(e)}, status_code=400)
    except RuntimeError as e:
        return JSONResponse({"ok": False, "detail": str(e)}, status_code=409)
    return JSONResponse({"ok": True, "run_id": rid}, status_code=202)
