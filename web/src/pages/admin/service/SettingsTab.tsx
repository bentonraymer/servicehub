import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CronBuilder } from "../../../components/CronBuilder";
import { EnvEditor, InputsEditor } from "../../../components/Inputs";
import { Card, SettingRow, Toggle, TYPE_META } from "../../../components/ui";
import { api, type FileEntry, type Group, type InputSpec, type Service, type ServiceType } from "../../../lib/api";
import { useLoad } from "../../../lib/hooks";

type Form = {
  name: string;
  description: string;
  icon: string;
  type: ServiceType;
  entrypoint: string;
  group_id: number | null;
  show_on_launcher: boolean;
  enabled: boolean;
  schedule: string;
  timeout_seconds: number;
  inputs: InputSpec[];
  env: [string, string][];
  notify_on_failure: boolean;
};

function toForm(s: Service): Form {
  return {
    name: s.name,
    description: s.description,
    icon: s.icon,
    type: s.type,
    entrypoint: s.entrypoint,
    group_id: s.group_id,
    show_on_launcher: s.show_on_launcher,
    enabled: s.enabled,
    schedule: s.schedule,
    timeout_seconds: s.timeout_seconds,
    inputs: s.inputs,
    env: Object.entries(s.env),
    notify_on_failure: s.notify_on_failure,
  };
}

const EMOJI = ["🧮", "📈", "🌤️", "🔔", "🤖", "🧹", "📬", "🗓️", "🎵", "📷", "🛠️", "💾", "🌐", "📝", "🔍", "⚡"];

export function SettingsTab({ s, onSaved }: { s: Service; onSaved: () => void }) {
  const groups = useLoad(() => api.get<Group[]>("/api/groups"), []);
  const filesQ = useLoad(() => api.get<FileEntry[]>(`/api/services/${s.slug}/files`), [s.slug]);
  const initial = useMemo(() => toForm(s), [s]);
  const [f, setF] = useState<Form>(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const nav = useNavigate();

  // Pick up outside changes when we have no local edits
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  useEffect(() => {
    if (!dirty) setF(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const set = (p: Partial<Form>) => setF((prev) => ({ ...prev, ...p }));

  const save = async () => {
    setSaving(true);
    setErr("");
    try {
      const env: Record<string, string> = {};
      for (const [k, v] of f.env) if (k.trim()) env[k.trim()] = v;
      await api.patch(`/api/services/${s.slug}`, { ...f, env, schedule: f.type === "script" ? f.schedule : "" });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!confirm(`Delete ${s.name}? Its code, versions, logs and DATA_DIR files are removed for good.`)) return;
    await api.del(`/api/services/${s.slug}`);
    nav("/admin/services");
  };

  const files = filesQ.data ?? [];
  const entryOptions = files.filter((x) => (f.type === "static" ? /\.html?$/.test(x.path) : x.path.endsWith(".py"))).map((x) => x.path);

  return (
    <div className="grid max-w-4xl gap-5 p-6 pb-24">
      <Card title="General" description="How this service is named and started.">
        <SettingRow label="Name">
          <input className="input" value={f.name} onChange={(e) => set({ name: e.target.value })} />
        </SettingRow>
        <SettingRow label="Description" hint="Shown on the launcher tile and panel.">
          <input className="input" value={f.description} placeholder="What does it do?" onChange={(e) => set({ description: e.target.value })} />
        </SettingRow>
        <SettingRow label="Icon" hint="An emoji. Leave empty for initials.">
          <div className="grid gap-2">
            <input className="input w-24 text-center text-lg" value={f.icon} maxLength={8} onChange={(e) => set({ icon: e.target.value })} />
            <div className="flex flex-wrap gap-1">
              {EMOJI.map((e) => (
                <button key={e} type="button" onClick={() => set({ icon: e })} className="grid size-8 place-items-center rounded-md text-lg hover:bg-white/5">{e}</button>
              ))}
            </div>
          </div>
        </SettingRow>
        <SettingRow label="Type" hint="Changing the type changes how it runs.">
          <select className="input" value={f.type} onChange={(e) => set({ type: e.target.value as ServiceType })}>
            {(Object.keys(TYPE_META) as ServiceType[]).map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
          </select>
        </SettingRow>
        <SettingRow label="Entrypoint" hint={f.type === "static" ? "The page served at /s/name/." : "The Python file ServiceHub runs."}>
          <input className="input font-mono" list="entry-options" value={f.entrypoint} onChange={(e) => set({ entrypoint: e.target.value })} />
          <datalist id="entry-options">{entryOptions.map((o) => <option key={o} value={o} />)}</datalist>
        </SettingRow>
        <SettingRow label="Enabled" hint="Disabled services don't run, aren't served and skip their schedule.">
          <div className="pt-1.5"><Toggle on={f.enabled} onChange={(v) => set({ enabled: v })} label="Enabled" /></div>
        </SettingRow>
      </Card>

      <Card title="Launcher" description="Where this shows up on the home page.">
        <SettingRow label="Show on launcher">
          <div className="pt-1.5"><Toggle on={f.show_on_launcher} onChange={(v) => set({ show_on_launcher: v })} label="Show on launcher" /></div>
        </SettingRow>
        <SettingRow label="Section">
          <select className="input" value={f.group_id ?? ""} onChange={(e) => set({ group_id: e.target.value ? +e.target.value : null })}>
            <option value="">No section</option>
            {groups.data?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </SettingRow>
      </Card>

      {f.type === "script" && (
        <>
          <Card title="Schedule" description="When this script runs on its own. You can always run it by hand too.">
            <CronBuilder value={f.schedule} onChange={(v) => set({ schedule: v })} />
          </Card>
          <Card title="Run form" description="Inputs people fill in before pressing Run. Scheduled runs use the defaults.">
            <InputsEditor value={f.inputs} onChange={(v) => set({ inputs: v })} />
          </Card>
        </>
      )}

      <Card title="Environment variables" description="Passed to your code. Handy for API keys and settings you don't want in the code.">
        <EnvEditor value={f.env} onChange={(v) => set({ env: v })} />
      </Card>

      <Card title="Behavior">
        {f.type === "script" && (
          <SettingRow label="Timeout" hint="Stop a run that takes longer than this. 0 means no limit.">
            <div className="flex items-center gap-2">
              <input type="number" min={0} className="input w-32 tabular-nums" value={f.timeout_seconds} onChange={(e) => set({ timeout_seconds: Math.max(0, +e.target.value || 0) })} />
              <span className="text-sm text-muted">seconds</span>
            </div>
          </SettingRow>
        )}
        <SettingRow label="Failure alerts" hint={f.type === "script" ? "Pushover alert on the first failed run, and when it recovers." : "Pushover alert if it crashes over and over."}>
          <div className="pt-1.5"><Toggle on={f.notify_on_failure} onChange={(v) => set({ notify_on_failure: v })} label="Failure alerts" /></div>
        </SettingRow>
      </Card>

      <Card title="Danger zone">
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm text-muted">Delete this service, its versions, logs and stored data.</div>
          <button className="btn-danger border border-down/30" onClick={del}><Trash2 size={14} /> Delete service</button>
        </div>
      </Card>

      {(dirty || err) && (
        <div className="fixed right-6 bottom-6 z-30 flex items-center gap-3 rounded-lg border border-line-2 bg-panel-2 px-4 py-2.5 shadow-xl pop-in">
          {err ? <span className="text-sm text-down">{err}</span> : <span className="text-sm text-muted">You have unsaved changes.</span>}
          <button className="btn-ghost py-1.5" onClick={() => { setF(initial); setErr(""); }}>Discard</button>
          <button className="btn-primary py-1.5" disabled={saving || !dirty} onClick={save}>{saving ? "Saving…" : "Save changes"}</button>
        </div>
      )}
    </div>
  );
}
