import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { LogViewer } from "../../../components/LogViewer";
import { Dash, Empty } from "../../../components/ui";
import { api, type Run, type Service } from "../../../lib/api";
import { useLoad, useTick } from "../../../lib/hooks";
import { absolute, duration, relative } from "../../../lib/time";
import { History } from "lucide-react";

export const RUN_PILL: Record<string, string> = {
  running: "bg-accent/15 text-accent",
  success: "bg-up/15 text-up",
  failed: "bg-down/15 text-down",
  timeout: "bg-down/15 text-down",
  cancelled: "bg-white/5 text-faint",
  interrupted: "bg-white/10 text-muted",
};

export function RunTable({ runs, showService }: { runs: Run[]; showService?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  useTick();
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-[13px]">
        <thead className="border-b border-line bg-panel text-xs text-muted">
          <tr>
            {["", "Run", ...(showService ? ["Service"] : []), "Status", "Trigger", "Started", "Duration", "Inputs"].map((h, i) => (
              <th key={i} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <Fragment key={r.id}>
              <tr className="cursor-pointer border-b border-line/70 hover:bg-white/[0.03]" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <td className="w-6 px-3 py-2"><ChevronRight size={14} className={clsx("text-faint transition-transform", open === r.id && "rotate-90")} /></td>
                <td className="px-3 py-2 font-mono text-xs">#{r.id}</td>
                {showService && <td className="px-3 py-2">{r.name}</td>}
                <td className="px-3 py-2">
                  <span className={clsx("rounded px-1.5 py-0.5 text-[11px] font-medium", RUN_PILL[r.status])}>{r.status}</span>
                  {r.exit_code != null && r.exit_code !== 0 && <span className="ml-1.5 font-mono text-[10px] text-faint">exit {r.exit_code}</span>}
                </td>
                <td className="px-3 py-2 text-xs text-muted">{r.trigger}</td>
                <td className="px-3 py-2 text-xs text-muted" title={absolute(r.started_at)}>{relative(r.started_at)}</td>
                <td className="px-3 py-2 text-xs tabular-nums">{r.status === "running" ? <span className="text-accent">running</span> : duration(r.duration_ms)}</td>
                <td className="max-w-[260px] truncate px-3 py-2 font-mono text-[11px] text-muted" title={JSON.stringify(r.inputs)}>
                  {Object.keys(r.inputs).length ? Object.entries(r.inputs).map(([k, v]) => `${k}=${String(v)}`).join(" ") : <Dash />}
                </td>
              </tr>
              {open === r.id && (
                <tr className="bg-panel/60">
                  <td colSpan={showService ? 8 : 7} className="px-6 py-4">
                    <LogViewer url={`/api/runs/${r.id}/stream`} className="h-80" />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {runs.length === 0 && (
            <tr><td colSpan={showService ? 8 : 7} className="px-3 py-10 text-center text-muted">No runs yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function RunsTab({ s }: { s: Service }) {
  const { data } = useLoad(() => api.get<Run[]>(`/api/runs?slug=${s.slug}&limit=200`), [s.slug], (e) => e.type === "run" && e.slug === s.slug);
  if (data && data.length === 0) {
    return <div className="p-6"><Empty icon={History}>No runs yet. Press Run now, or set a schedule in Settings.</Empty></div>;
  }
  return <div className="p-6">{data && <RunTable runs={data} />}</div>;
}
