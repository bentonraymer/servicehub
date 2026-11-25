import { Lock, LockOpen, RefreshCw, Trash2, Webhook } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CronBuilder } from "../../../components/CronBuilder";
import { EnvEditor, InputsEditor } from "../../../components/Inputs";
import { SecretPicker } from "../../../components/Secrets";
import { Card, CopyBlock, SettingRow, Toggle, TYPE_META } from "../../../components/ui";
import { api, type FileEntry, type Group, type InputSpec, type Service, type ServiceType, type Settings } from "../../../lib/api";
import { relative } from "../../../lib/time";
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
  secrets: string[];
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
    secrets: s.secrets,
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
        {s.type !== "static" && (
          <SettingRow label="Tile output" hint={<>Print a line starting with <span className="font-mono">::tile::</span> to show text on the tile.</>}>
            <div className="flex flex-wrap items-center gap-3 pt-2 text-sm">
              {s.tile ? (
                <>
                  <span className={s.tile.tone === "up" ? "text-up" : s.tile.tone === "down" ? "text-down" : s.tile.tone === "warn" ? "text-warn" : ""}>{s.tile.text}</span>
                  <span className="text-xs text-faint">{relative(s.tile.t)}</span>
                  <button type="button" className="btn-ghost py-1 text-xs" onClick={async () => { await api.del(`/api/services/${s.slug}/tile`); onSaved(); }}>Clear</button>
                </>
              ) : <span className="text-faint">Nothing yet</span>}
            </div>
          </SettingRow>
        )}
      </Card>

      <AccessCard s={s} onSaved={onSaved} />

      {f.type === "script" && (
        <>
          <Card title="Schedule" description="When this script runs on its own. You can always run it by hand too.">
            <CronBuilder value={f.schedule} onChange={(v) => set({ schedule: v })} />
          </Card>
          <Card title="Run form" description="Inputs people fill in before pressing Run. Scheduled runs use the defaults.">
            <InputsEditor value={f.inputs} onChange={(v) => set({ inputs: v })} />
          </Card>
          <WebhookCard s={s} onSaved={onSaved} />
        </>
      )}

      <Card title="Environment variables" description="Passed to your code. Handy for API keys and settings you don't want in the code.">
        <EnvEditor value={f.env} onChange={(v) => set({ env: v })} />
        <div className="border-t border-line pt-4">
          <div className="mb-1 text-sm">Shared secrets</div>
          <div className="mb-1 text-xs text-faint">Click to attach. A variable above with the same name wins.</div>
          <SecretPicker value={f.secrets} onChange={(v) => set({ secrets: v })} />
        </div>
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

function AccessCard({ s, onSaved }: { s: Service; onSaved: () => void }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const what = s.type === "static" || s.type === "webapp" ? `its page at /s/${s.slug}/` : "its controls on the launcher";
  const save = async (value: string) => {
    if (!value && !confirm(`Remove the password from ${s.name}? Anyone who can reach ServiceHub will be able to use it.`)) return;
    setBusy(true);
    setErr("");
    try {
      await api.patch(`/api/services/${s.slug}`, { access_password: value });
      setPw("");
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Access" description={`Who can open ${what}. Admin mode always has access.`}>
      <SettingRow label="Status">
        <div className="flex items-center gap-2 pt-2 text-sm">
          {s.has_password
            ? <><Lock size={14} className="text-accent" /> Needs its own password</>
            : <><LockOpen size={14} className="text-faint" /> Open to anyone who can reach ServiceHub</>}
        </div>
      </SettingRow>
      <SettingRow label={s.has_password ? "Change password" : "Set a password"} hint="Separate from the admin password. Changing it signs everyone out of this service.">
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (pw) save(pw); }}>
          <input type="password" autoComplete="new-password" className="input max-w-xs" placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button className="btn-outline" disabled={busy || !pw}>{s.has_password ? "Change" : "Set password"}</button>
          {s.has_password && <button type="button" className="btn-danger" disabled={busy} onClick={() => save("")}>Remove</button>}
        </form>
        {err && <div className="mt-2 text-sm text-down">{err}</div>}
      </SettingRow>
    </Card>
  );
}

function WebhookCard({ s, onSaved }: { s: Service; onSaved: () => void }) {
  const [origin, setOrigin] = useState(location.origin);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get<Settings>("/api/settings").then((d) => d.public_url && setOrigin(d.public_url.replace(/\/+$/, ""))).catch(() => {});
  }, []);
  const act = async (method: "post" | "del", ask?: string) => {
    if (ask && !confirm(ask)) return;
    setBusy(true);
    try {
      if (method === "post") await api.post(`/api/services/${s.slug}/webhook`);
      else await api.del(`/api/services/${s.slug}/webhook`);
      onSaved();
    } finally {
      setBusy(false);
    }
  };
  const url = `${origin}/hooks/${s.slug}/${s.webhook_token}`;
  const example = s.inputs.length
    ? `curl -X POST -H 'content-type: application/json' \\\n  -d '${JSON.stringify(Object.fromEntries(s.inputs.slice(0, 2).map((i) => [i.name, i.type === "number" ? 1 : i.type === "checkbox" ? true : "value"])))}' \\\n  ${url}`
    : `curl -X POST ${url}`;
  return (
    <Card
      title="Webhook"
      description="A secret URL that runs this script from anywhere: Home Assistant, IFTTT, a cron job on another box. It works without the admin or service password, so keep it private."
      actions={s.webhook_token ? (
        <>
          <button className="btn-ghost py-1 text-xs whitespace-nowrap" disabled={busy} onClick={() => act("post", "Make a new URL? The current one stops working.")}><RefreshCw size={13} /> New URL</button>
          <button className="btn-danger py-1 text-xs whitespace-nowrap" disabled={busy} onClick={() => act("del", "Turn off the webhook? The URL stops working.")}>Turn off</button>
        </>
      ) : undefined}
    >
      {s.webhook_token ? (
        <>
          <CopyBlock text={url} />
          <div className="text-xs text-muted">
            GET or POST. Query parameters and a JSON or form body fill in the run form's inputs by name; missing ones use their defaults.
            The raw body is also in <span className="font-mono">SERVICEHUB_WEBHOOK_BODY</span>, and <span className="font-mono">SERVICEHUB_TRIGGER</span> is <span className="font-mono">webhook</span>.
          </div>
          <CopyBlock text={example} />
        </>
      ) : (
        <div className="flex items-center gap-3">
          <button className="btn-outline" disabled={busy} onClick={() => act("post")}><Webhook size={14} /> Turn on webhook</button>
          <span className="text-xs text-faint">Off. Nothing outside ServiceHub can run this script.</span>
        </div>
      )}
    </Card>
  );
}
