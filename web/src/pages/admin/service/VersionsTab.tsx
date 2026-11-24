import { Download, RotateCcw } from "lucide-react";
import { useState } from "react";
import { api, type Service, type Version } from "../../../lib/api";
import { useLoad, useTick } from "../../../lib/hooks";
import { absolute, bytes, relative } from "../../../lib/time";

export function VersionsTab({ s, onRestored }: { s: Service; onRestored: () => void }) {
  const { data, reload } = useLoad(() => api.get<Version[]>(`/api/services/${s.slug}/versions`), [s.slug, s.current_version]);
  const [busy, setBusy] = useState<number | null>(null);
  useTick();

  const restore = async (v: Version) => {
    const msg = s.status.dirty
      ? `Roll back to version ${v.number}? Your undeployed changes will be lost. Files in DATA_DIR aren't touched.`
      : `Roll back to version ${v.number}? The code will be replaced with that version${s.type === "worker" || s.type === "webapp" ? " and the service restarted" : ""}. Files in DATA_DIR aren't touched.`;
    if (!confirm(msg)) return;
    setBusy(v.number);
    try {
      await api.post(`/api/services/${s.slug}/versions/${v.number}/restore`);
      onRestored();
      reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid max-w-4xl gap-3 p-6">
      <p className="text-xs text-muted">Every deploy saves a snapshot of the code. ServiceHub keeps the most recent 30.</p>
      {data?.map((v) => (
        <div key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-panel px-4 py-3">
          <div className="grid size-8 place-items-center rounded-full bg-white/5 font-mono text-xs text-muted">v{v.number}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{v.note || "No note"}</span>
              <span className="rounded bg-white/5 px-1.5 py-px text-[11px] text-muted">{v.source}</span>
              {v.number === s.current_version && <span className="rounded bg-accent/15 px-1.5 py-px text-[11px] text-accent">current</span>}
            </div>
            <div className="text-xs text-muted" title={absolute(v.created_at)}>{relative(v.created_at)} · {bytes(v.size)}</div>
          </div>
          <a className="btn-ghost p-1.5" title="Download zip" href={`/api/services/${s.slug}/versions/${v.number}/download`}><Download size={14} /></a>
          {v.number !== s.current_version || s.status.dirty ? (
            <button className="btn-outline py-1 text-xs" disabled={busy !== null} onClick={() => restore(v)}>
              <RotateCcw size={13} /> {busy === v.number ? "Restoring…" : "Roll back"}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
