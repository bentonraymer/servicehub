import clsx from "clsx";
import { LogOut, Play, RotateCw, Search, Settings2, Square, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Backdrop } from "../components/Backdrop";
import { defaults, InputForm, type InputValues } from "../components/Inputs";
import { LogViewer } from "../components/LogViewer";
import { Logo, ServiceIcon, StatusDot, StatusPill, statusInfo, TYPE_META } from "../components/ui";
import { api, type Group, type LauncherService, type Run } from "../lib/api";
import { useKey, useLoad, useTick } from "../lib/hooks";
import { duration, relative, uptime } from "../lib/time";

type LauncherData = { groups: Group[]; services: LauncherService[] };

export default function Launcher() {
  const { data } = useLoad(() => api.get<LauncherData>("/api/launcher"), [], (e) => e.type === "status" || e.type === "layout" || e.type === "run");
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState("");
  const [authOn, setAuthOn] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  useTick();

  useEffect(() => {
    api.get<{ enabled: boolean }>("/api/auth/status").then((s) => setAuthOn(s.enabled)).catch(() => {});
  }, []);

  useKey("/", (e) => {
    if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return;
    e.preventDefault();
    searchRef.current?.focus();
  });

  const openSlug = params.get("open");
  const open = data?.services.find((s) => s.slug === openSlug) ?? null;
  const setOpen = (slug: string | null) => setParams(slug ? { open: slug } : {}, { replace: true });

  const sections = useMemo(() => {
    if (!data) return [];
    const q = filter.trim().toLowerCase();
    const match = (s: LauncherService) => !q || s.name.toLowerCase().includes(q) || s.slug.includes(q) || s.description.toLowerCase().includes(q);
    const byGroup = (gid: number | null) => data.services.filter((s) => s.group_id === gid && match(s)).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    const out = data.groups.map((g) => ({ key: String(g.id), name: g.name, items: byGroup(g.id) }));
    const orphans = data.services.filter((s) => (s.group_id == null || !data.groups.some((g) => g.id === s.group_id)) && match(s));
    if (orphans.length) out.push({ key: "none", name: data.groups.length ? "Other" : "Services", items: orphans.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)) });
    return out.filter((s) => s.items.length > 0 || !q);
  }, [data, filter]);

  const logout = async () => {
    await api.post("/api/auth/logout");
    location.href = "/login";
  };

  const total = data?.services.length ?? 0;

  return (
    <div className="min-h-full">
      <Backdrop />
      <header className="sticky top-0 z-20 flex items-center gap-4 px-6 py-4">
        <div className="flex items-center gap-2.5">
          <Logo size={26} />
          <span className="text-lg font-semibold tracking-tight text-white/95">ServiceHub</span>
        </div>
        <div className="mx-auto w-full max-w-md">
          <label className="glass flex items-center gap-2 rounded-full px-4 py-2 text-sm text-white/50">
            <Search size={14} />
            <input
              ref={searchRef}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && (setFilter(""), e.currentTarget.blur())}
              placeholder="Filter services"
              className="w-full bg-transparent text-white/90 outline-none placeholder:text-white/50"
            />
            {filter ? (
              <button onClick={() => setFilter("")} className="text-white/50 hover:text-white" title="Clear"><X size={13} /></button>
            ) : (
              <span className="kbd">/</span>
            )}
          </label>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/admin" title="Admin mode" className="glass grid size-9 place-items-center rounded-full text-white/70 transition hover:text-white">
            <Settings2 size={16} />
          </Link>
          {authOn && (
            <button onClick={logout} title="Sign out" className="glass grid size-9 place-items-center rounded-full text-white/70 transition hover:text-white">
              <LogOut size={15} />
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-[1680px] px-6 pt-4 pb-16">
        {data && total === 0 ? (
          <div className="mx-auto mt-[10vh] max-w-lg">
            <div className="glass grid justify-items-center gap-3 rounded-2xl p-10 text-center">
              <h1 className="text-2xl font-semibold tracking-tight text-white/95">Nothing here yet</h1>
              <p className="text-sm text-white/50">
                Add a static page, a script, a worker or a small web app in admin mode. Anything you mark “Show on launcher” appears here.
              </p>
              <div className="mt-2 flex gap-2">
                <Link to="/admin/services?new=1" className="btn-primary">Create a service</Link>
                <Link to="/admin" className="btn-outline border-white/15">Open admin</Link>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-x-10 gap-y-8 md:grid-cols-2 2xl:grid-cols-3">
            {sections.map((sec) => {
              const down = sec.items.filter((s) => statusInfo(s.type, s.status).dot === "down").length;
              return (
                <section key={sec.key} className={clsx(sections.length === 1 && "md:col-span-2 2xl:col-span-3")}>
                  <div className="mb-3 flex items-center gap-2 border-b border-dashed border-white/15 pb-2">
                    <h2 className="text-[17px] font-semibold tracking-tight text-white/95">{sec.name}</h2>
                    <span className="text-xs text-white/35 tabular-nums">{sec.items.length}</span>
                    {down > 0 && <span className="rounded-full bg-down/20 px-2 py-0.5 text-[11px] font-semibold text-down">{down} down</span>}
                  </div>
                  {sec.items.length === 0 ? (
                    <div className="py-4 text-sm text-white/35">No services in this section.</div>
                  ) : (
                    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(138px, 1fr))" }}>
                      {sec.items.map((s) => <Tile key={s.id} s={s} onOpen={() => setOpen(s.slug)} />)}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </main>

      {open && <ServicePanel s={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Tile({ s, onOpen }: { s: LauncherService; onOpen: () => void }) {
  const info = statusInfo(s.type, s.status);
  const isLink = s.type === "static" || s.type === "webapp";
  const cls = clsx(
    "group glass relative flex flex-col items-center gap-2.5 rounded-xl px-3 py-4 transition duration-200",
    "hover:-translate-y-0.5 hover:bg-white/[0.06] hover:shadow-[0_14px_30px_-12px_rgba(0,0,0,0.8)]",
    info.dot === "down" && "shadow-[0_0_0_1px_rgba(255,77,109,0.5),0_0_24px_-4px_rgba(255,77,109,0.45)]",
    !s.enabled && "opacity-55",
  );
  const body = (
    <>
      <span className="absolute top-2.5 right-2.5"><StatusDot kind={info.dot} title={info.label} small /></span>
      <span className="w-full truncate text-center text-[14px] font-medium text-white/90" title={s.description || s.name}>{s.name}</span>
      <ServiceIcon name={s.name} icon={s.icon} className="size-11 text-xl drop-shadow-[0_4px_10px_rgba(0,0,0,0.35)] transition duration-200 group-hover:scale-105" />
    </>
  );
  if (isLink) {
    return <a href={`/s/${s.slug}/`} className={cls} title={s.description || undefined}>{body}</a>;
  }
  return <button onClick={onOpen} className={cls} title={s.description || undefined}>{body}</button>;
}

function ServicePanel({ s, onClose }: { s: LauncherService; onClose: () => void }) {
  const M = TYPE_META[s.type];
  useKey("Escape", onClose);
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/45 p-4 pt-[10vh] backdrop-blur-md" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal className="glass-strong pop-in w-full max-w-[720px] rounded-2xl shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]">
        <div className="flex items-start gap-3 px-5 py-4">
          <ServiceIcon name={s.name} icon={s.icon} className="size-10 text-lg" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-[17px] font-semibold tracking-tight text-white/95">{s.name}</h2>
              <StatusPill type={s.type} status={s.status} />
            </div>
            <div className="mt-0.5 text-xs text-white/45">{s.description || M.blurb}</div>
          </div>
          <Link to={`/admin/services/${s.slug}`} className="btn-ghost p-1.5 text-white/60" title="Open in admin"><Settings2 size={15} /></Link>
          <button className="btn-ghost -mr-1 p-1.5 text-white/60" onClick={onClose} title="Close"><X size={16} /></button>
        </div>
        <div className="border-t border-white/8 px-5 py-4">
          {s.type === "script" ? <ScriptRunner s={s} /> : <WorkerView s={s} />}
        </div>
      </div>
    </div>
  );
}

function ScriptRunner({ s }: { s: LauncherService }) {
  const [values, setValues] = useState<InputValues>(() => defaults(s.inputs));
  const [runId, setRunId] = useState<number | null>(s.status.running_run ?? s.status.last_run?.id ?? null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const runs = useLoad(() => api.get<Run[]>(`/api/runs?slug=${s.slug}&limit=6`), [s.slug], (e) => e.type === "run" && e.slug === s.slug);
  const running = s.status.state === "running";

  // Follow scheduled runs that start while the panel is open
  useEffect(() => {
    if (s.status.running_run) setRunId(s.status.running_run);
  }, [s.status.running_run]);

  const run = async () => {
    setErr("");
    setBusy(true);
    try {
      const r = await api.post<{ run_id: number }>(`/api/services/${s.slug}/run`, { inputs: values });
      setRunId(r.run_id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (s.status.running_run) await api.post(`/api/runs/${s.status.running_run}/cancel`).catch(() => {});
  };

  return (
    <div className="grid gap-4">
      {s.inputs.length > 0 && <InputForm specs={s.inputs} values={values} onChange={setValues} glass onSubmit={run} />}
      <div className="flex items-center gap-2">
        {running ? (
          <button className="btn-outline border-white/15" onClick={cancel}><Square size={13} /> Stop run</button>
        ) : (
          <button className="btn-primary" onClick={run} disabled={busy || !s.enabled}><Play size={14} /> {busy ? "Starting…" : "Run now"}</button>
        )}
        {err && <span className="text-sm text-down">{err}</span>}
        {!err && s.status.next_run && <span className="ml-auto text-xs text-white/40">Next scheduled run {relative(s.status.next_run)}</span>}
      </div>
      <LogViewer glass url={runId ? `/api/runs/${runId}/stream` : null} className="h-72" emptyText="Press Run to see the output here." />
      {runs.data && runs.data.length > 0 && (
        <div className="grid gap-1">
          <div className="text-[11px] font-semibold tracking-widest text-white/35 uppercase">Recent runs</div>
          <div className="flex flex-wrap gap-1.5">
            {runs.data.map((r) => (
              <button key={r.id} onClick={() => setRunId(r.id)}
                className={clsx("flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition",
                  r.id === runId ? "border-accent/60 bg-accent/10 text-white/90" : "border-white/8 text-white/55 hover:text-white/90")}>
                <StatusDot small kind={r.status === "success" ? "up" : r.status === "running" ? "maintenance" : r.status === "cancelled" || r.status === "interrupted" ? "paused" : "down"} title={r.status} />
                <span className="tabular-nums">#{r.id}</span>
                <span className="text-white/35">{relative(r.started_at)}</span>
                {r.duration_ms != null && <span className="text-white/35 tabular-nums">· {duration(r.duration_ms)}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WorkerView({ s }: { s: LauncherService }) {
  const [busy, setBusy] = useState("");
  const act = async (a: "start" | "stop" | "restart") => {
    setBusy(a);
    try {
      await api.post(`/api/services/${s.slug}/${a}`);
    } finally {
      setBusy("");
    }
  };
  const st = s.status;
  const up = ["running", "starting", "installing", "backoff"].includes(st.state);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {up ? (
          <>
            <button className="btn-outline border-white/15" disabled={!!busy} onClick={() => act("restart")}><RotateCw size={13} className={clsx(busy === "restart" && "animate-spin")} /> Restart</button>
            <button className="btn-ghost" disabled={!!busy} onClick={() => act("stop")}><Square size={13} /> Stop</button>
          </>
        ) : (
          <button className="btn-primary" disabled={!!busy || !s.enabled} onClick={() => act("start")}><Play size={14} /> Start</button>
        )}
        <div className="ml-auto flex gap-4 text-xs text-white/45">
          {st.started_at && <span>Up <span className="text-white/80 tabular-nums">{uptime(st.started_at)}</span></span>}
          {!!st.restarts && <span>Restarts <span className="text-white/80 tabular-nums">{st.restarts}</span></span>}
          {st.pid && <span>PID <span className="font-mono text-white/80">{st.pid}</span></span>}
        </div>
      </div>
      {st.detail && <div className="text-xs text-warn">{st.detail}</div>}
      <LogViewer glass url={`/api/services/${s.slug}/logs/stream`} className="h-80" />
    </div>
  );
}
