import { Eraser } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { LogViewer } from "../../../components/LogViewer";
import { Card, Dash } from "../../../components/ui";
import { api, type Service } from "../../../lib/api";
import { useTick } from "../../../lib/hooks";
import { absolute, duration, relative, uptime } from "../../../lib/time";

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/70 py-1.5 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className="text-right tabular-nums">{children}</span>
    </div>
  );
}

export function OverviewTab({ s }: { s: Service }) {
  useTick(5000);
  const st = s.status;
  const [runId, setRunId] = useState<number | null>(st.running_run ?? st.last_run?.id ?? null);
  const [logKey, setLogKey] = useState(0);
  useEffect(() => {
    if (st.running_run) setRunId(st.running_run);
  }, [st.running_run]);

  const clear = async () => {
    await api.post(`/api/services/${s.slug}/logs/clear`);
    setLogKey((k) => k + 1);
  };

  const url = s.type === "script" ? (runId ? `/api/runs/${runId}/stream` : null) : s.type === "static" ? null : `/api/services/${s.slug}/logs/stream?k=${logKey}`;

  return (
    <div className="grid gap-5 p-6 xl:grid-cols-[340px_1fr]">
      <div className="grid content-start gap-5">
        <Card title="Status">
          <div className="-my-2">
            {st.detail && <div className="mb-2 rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">{st.detail}</div>}
            {(s.type === "static" || s.type === "webapp") && (
              <Stat label="URL"><a className="font-mono text-xs text-accent hover:underline" href={`/s/${s.slug}/`} target="_blank" rel="noreferrer">/s/{s.slug}/</a></Stat>
            )}
            <Stat label="Entrypoint"><span className="font-mono text-xs">{s.entrypoint}</span></Stat>
            {(s.type === "worker" || s.type === "webapp") && (
              <>
                <Stat label="Uptime">{st.started_at ? uptime(st.started_at) : <Dash />}</Stat>
                <Stat label="PID"><span className="font-mono text-xs">{st.pid ?? "—"}</span></Stat>
                {s.type === "webapp" && <Stat label="Internal port"><span className="font-mono text-xs">{st.port}</span></Stat>}
                <Stat label="Restarts">{st.restarts ?? 0}</Stat>
                <Stat label="Last exit code"><span className="font-mono text-xs">{st.last_exit ?? "—"}</span></Stat>
              </>
            )}
            {s.type === "script" && (
              <>
                <Stat label="Schedule">{s.schedule ? <span className="font-mono text-xs">{s.schedule}</span> : <span className="text-faint">Manual only</span>}</Stat>
                <Stat label="Next run"><span title={absolute(st.next_run)}>{st.next_run ? relative(st.next_run) : <Dash />}</span></Stat>
                <Stat label="Last run">
                  {st.last_run ? (
                    <span title={absolute(st.last_run.finished_at)}>
                      <span className={st.last_run.status === "success" ? "text-up" : "text-down"}>{st.last_run.status}</span>{" "}
                      <span className="text-muted">· {relative(st.last_run.finished_at)} · {duration(st.last_run.duration_ms)}</span>
                    </span>
                  ) : <Dash />}
                </Stat>
                <Stat label="Timeout">{s.timeout_seconds ? duration(s.timeout_seconds * 1000) : "None"}</Stat>
              </>
            )}
            <Stat label="Version">{s.current_version ? `v${s.current_version}` : <Dash />}{st.dirty && <span className="ml-1.5 text-xs text-warn">· undeployed changes</span>}</Stat>
            <Stat label="On launcher">{s.show_on_launcher ? "Yes" : "No"}</Stat>
            <Stat label="Failure alerts">{s.notify_on_failure ? "On" : "Off"}</Stat>
          </div>
        </Card>
        <Card title="Environment" description="What your code can rely on.">
          <div className="grid gap-1.5 text-xs text-muted">
            <div><span className="font-mono text-fg">DATA_DIR</span> · a folder that survives redeploys and rollbacks.</div>
            {s.type === "webapp" && <div><span className="font-mono text-fg">PORT</span> · listen on 127.0.0.1 at this port.</div>}
            {s.type === "webapp" && <div><span className="font-mono text-fg">SERVICEHUB_BASE_PATH</span> · <span className="font-mono">/s/{s.slug}</span>; also sent as <span className="font-mono">X-Forwarded-Prefix</span>.</div>}
            {s.type === "script" && <div><span className="font-mono text-fg">INPUT_*</span> and <span className="font-mono text-fg">SERVICEHUB_INPUTS</span> · values from the run form.</div>}
            {Object.keys(s.env).length > 0 && <div>Plus {Object.keys(s.env).length} variable(s) you set in Settings.</div>}
          </div>
        </Card>
      </div>
      {s.type === "static" ? (
        <Card title="Preview" description="The page as visitors see it." bodyClassName="p-0">
          <iframe title="preview" src={`/s/${s.slug}/`} className="h-[65vh] w-full rounded-b-lg bg-white" />
        </Card>
      ) : (
        <Card
          title={s.type === "script" ? (runId ? `Run #${runId}` : "Output") : "Logs"}
          description={s.type === "script" ? "Live output of the current or most recent run." : "Live output from the process. stderr is shown in red."}
          actions={s.type !== "script" && <button className="btn-ghost py-1 text-xs" onClick={clear}><Eraser size={13} /> Clear</button>}
          bodyClassName="p-3"
        >
          <LogViewer url={url} className="h-[65vh]" emptyText={s.type === "script" ? "This script hasn't run yet. Press Run now." : "No output yet."} />
        </Card>
      )}
    </div>
  );
}
