import clsx from "clsx";
import { ExternalLink, Play, Plus, RotateCw, Search, Server, Square } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Dash, Empty, PageHeader, ServiceIcon, Segmented, StatusDot, StatusPill, statusInfo, TypeChip } from "../../components/ui";
import { api, type Group, type Service, type ServiceType } from "../../lib/api";
import { useLoad, useTick } from "../../lib/hooks";
import { absolute, relative } from "../../lib/time";
import { NewServiceModal } from "./NewService";

type Filter = "all" | "running" | "scheduled" | "failing";

export default function Services() {
  const { data } = useLoad(() => api.get<Service[]>("/api/services"), [], (e) => e.type === "status" || e.type === "layout" || e.type === "run");
  const groups = useLoad(() => api.get<Group[]>("/api/groups"), []);
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>("all");
  const [type, setType] = useState<ServiceType | "all">("all");
  const [q, setQ] = useState("");
  const nav = useNavigate();
  useTick();

  const showNew = params.get("new") === "1";
  const setNew = (v: boolean) => setParams(v ? { new: "1" } : {}, { replace: true });

  const counts = useMemo(() => {
    const list = data ?? [];
    return {
      running: list.filter((s) => ["running", "up"].includes(s.status.state)).length,
      scheduled: list.filter((s) => s.type === "script" && s.schedule && s.enabled).length,
      failing: list.filter((s) => statusInfo(s.type, s.status).dot === "down").length,
      total: list.length,
    };
  }, [data]);

  const rows = useMemo(() => {
    let list = data ?? [];
    if (filter === "running") list = list.filter((s) => ["running", "up"].includes(s.status.state));
    if (filter === "scheduled") list = list.filter((s) => s.type === "script" && s.schedule && s.enabled);
    if (filter === "failing") list = list.filter((s) => statusInfo(s.type, s.status).dot === "down");
    if (type !== "all") list = list.filter((s) => s.type === type);
    const qq = q.trim().toLowerCase();
    if (qq) list = list.filter((s) => s.name.toLowerCase().includes(qq) || s.slug.includes(qq));
    return list;
  }, [data, filter, type, q]);

  const tile = (key: Filter, n: number, label: string, tone = "text-accent") => (
    <button key={key} onClick={() => setFilter(filter === key ? "all" : key)}
      className={clsx("rounded-lg border bg-panel px-4 py-3 text-left transition", filter === key ? "border-accent" : "border-line hover:border-line-2")}>
      <div className={clsx("text-2xl font-semibold tabular-nums", n > 0 ? tone : "text-faint")}>{n}</div>
      <div className="text-xs text-muted">{label}</div>
    </button>
  );

  const act = async (e: React.MouseEvent, s: Service, a: string) => {
    e.stopPropagation();
    await api.post(`/api/services/${s.slug}/${a}`, a === "run" ? { inputs: {} } : undefined).catch((err) => alert(err.message));
  };

  return (
    <>
      <PageHeader
        title="Services"
        subtitle="Everything ServiceHub runs for you: pages, scripts, workers and web apps."
        actions={<button className="btn-primary py-1.5" onClick={() => setNew(true)}><Plus size={14} /> New service</button>}
      />
      <div className="grid gap-5 p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {tile("all", counts.total, "Services")}
          {tile("running", counts.running, "Live or running", "text-up")}
          {tile("scheduled", counts.scheduled, "Scheduled scripts")}
          {tile("failing", counts.failing, "Failing", "text-down")}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Segmented<ServiceType | "all">
            value={type}
            onChange={setType}
            options={[
              { value: "all", label: "All types" },
              { value: "static", label: "Static" },
              { value: "script", label: "Scripts" },
              { value: "worker", label: "Workers" },
              { value: "webapp", label: "Web apps" },
            ]}
          />
          <div className="relative ml-auto">
            <Search size={13} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
            <input className="input w-64 py-1 pl-8 text-xs" placeholder="Search services" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        {data && data.length === 0 ? (
          <Empty icon={Server} action={<button className="btn-outline" onClick={() => setNew(true)}><Plus size={14} /> New service</button>}>
            No services yet. Start with something small, like a single HTML page for a tip calculator or a Python script that checks a website every morning.
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-[13px]">
              <thead className="border-b border-line bg-panel text-xs text-muted">
                <tr>
                  {["", "Service", "Type", "Status", "Schedule", "Last run", "Next run", ""].map((h, i) => (
                    <th key={i} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const info = statusInfo(s.type, s.status);
                  const live = ["running", "starting", "installing", "backoff"].includes(s.status.state);
                  return (
                    <tr key={s.id} onClick={() => nav(`/admin/services/${s.slug}`)}
                      className={clsx("cursor-pointer border-b border-line/70 hover:bg-white/[0.03]", !s.enabled && "opacity-60")}>
                      <td className="w-8 px-3 py-2"><StatusDot kind={info.dot} title={info.label} small /></td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2.5">
                          <ServiceIcon name={s.name} icon={s.icon} className="size-7 rounded-lg text-sm" />
                          <div className="min-w-0">
                            <div className="truncate font-medium">{s.name}</div>
                            <div className="font-mono text-[10px] text-faint">{s.slug}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2"><TypeChip type={s.type} /></td>
                      <td className="px-3 py-2"><StatusPill type={s.type} status={s.status} /></td>
                      <td className="px-3 py-2 font-mono text-xs">{s.type === "script" && s.schedule ? s.schedule : <Dash />}</td>
                      <td className="px-3 py-2 text-xs text-muted" title={absolute(s.status.last_run?.finished_at)}>
                        {s.status.last_run ? relative(s.status.last_run.finished_at) : <Dash />}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted" title={absolute(s.status.next_run)}>
                        {s.status.next_run ? relative(s.status.next_run) : <Dash />}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-0.5">
                          {(s.type === "static" || s.type === "webapp") && (
                            <a className="btn-ghost p-1.5" title="Open" href={`/s/${s.slug}/`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                              <ExternalLink size={14} />
                            </a>
                          )}
                          {s.type === "script" && (
                            s.status.state === "running"
                              ? <button className="btn-ghost p-1.5" title="Stop run" onClick={(e) => act(e, s, "stop")}><Square size={14} /></button>
                              : <button className="btn-ghost p-1.5" title={s.inputs.length ? "Run with default inputs" : "Run now"} disabled={!s.enabled} onClick={(e) => act(e, s, "run")}><Play size={14} /></button>
                          )}
                          {(s.type === "worker" || s.type === "webapp") && (
                            live ? (
                              <>
                                <button className="btn-ghost p-1.5" title="Restart" onClick={(e) => act(e, s, "restart")}><RotateCw size={14} /></button>
                                <button className="btn-ghost p-1.5" title="Stop" onClick={(e) => act(e, s, "stop")}><Square size={14} /></button>
                              </>
                            ) : (
                              <button className="btn-ghost p-1.5" title="Start" disabled={!s.enabled} onClick={(e) => act(e, s, "start")}><Play size={14} /></button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && data && (
                  <tr><td colSpan={8} className="px-3 py-10 text-center text-muted">No services match these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {showNew && <NewServiceModal groups={groups.data ?? []} onClose={() => setNew(false)} />}
    </>
  );
}
