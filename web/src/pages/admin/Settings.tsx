import { Bell, Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, PageHeader, SettingRow, Spinner } from "../../components/ui";
import { api, type Settings } from "../../lib/api";
import { absolute } from "../../lib/time";

function CopyBlock({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border border-line bg-[#0c0f15] px-3.5 py-3 pr-20 font-mono text-xs leading-relaxed text-fg/90">{text}</pre>
      <button className="btn-ghost absolute top-1.5 right-1.5 py-1 text-xs" onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}>
        {done ? <><Check size={13} className="text-up" /> Copied</> : <><Copy size={13} /> Copy</>}
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [user, setUser] = useState("");
  const [token, setToken] = useState("");
  const [publicUrl, setPublicUrl] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [newToken, setNewToken] = useState("");

  useEffect(() => {
    api.get<Settings>("/api/settings").then((d) => {
      setS(d);
      setUser(d.pushover_user);
      setPublicUrl(d.public_url);
    });
  }, []);

  if (!s) return <div className="grid h-40 place-items-center"><Spinner /></div>;

  const savePushover = async () => {
    setBusy("save");
    setMsg(null);
    try {
      const body: Record<string, string> = { pushover_user: user, public_url: publicUrl };
      if (token) body.pushover_token = token;
      const d = await api.patch<Settings>("/api/settings", body);
      setS(d);
      setToken("");
      setMsg({ ok: true, text: "Saved." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy("");
    }
  };

  const test = async () => {
    setBusy("test");
    setMsg(null);
    try {
      await api.post("/api/settings/test-notification");
      setMsg({ ok: true, text: "Test sent. Check your phone." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy("");
    }
  };

  const makeToken = async () => {
    if (s.api_token_hint && !confirm("Make a new token? The current one stops working right away.")) return;
    const d = await api.post<Settings & { token: string }>("/api/settings/api-token");
    setNewToken(d.token);
    setS(d);
  };

  const revoke = async () => {
    if (!confirm("Revoke the API token? Scripts and tools using it will stop working.")) return;
    setS(await api.del<Settings>("/api/settings/api-token"));
    setNewToken("");
  };

  const origin = location.origin;
  const tok = newToken || "$SERVICEHUB_TOKEN";
  const curlDeploy = `# Deploy a folder (zipped) as a scheduled script, creating it if needed
cd my-script && zip -qr /tmp/my-script.zip . && \\
curl -fsS -H "Authorization: Bearer ${tok}" \\
  -F type=script -F entrypoint=main.py -F note="from my laptop" \\
  -F file=@/tmp/my-script.zip \\
  ${origin}/api/deploy/my-script`;
  const curlSingle = `# Deploy a single HTML file as a static page
curl -fsS -H "Authorization: Bearer ${tok}" \\
  -F type=static -F file=@index.html \\
  ${origin}/api/deploy/tip-calc`;
  const curlRun = `# Run a script with inputs
curl -fsS -H "Authorization: Bearer ${tok}" -H "content-type: application/json" \\
  -d '{"inputs": {"name": "Ada"}}' \\
  ${origin}/api/services/my-script/run`;

  return (
    <>
      <PageHeader title="Settings" subtitle="Notifications, API access and details about this ServiceHub." />
      <div className="grid max-w-4xl gap-5 p-6">
        <Card title="Pushover notifications" description="Get a push when a script fails (and when it recovers) or a worker keeps crashing.">
          {s.pushover_from_env && (
            <div className="rounded-lg border border-accent/40 bg-accent/5 px-4 py-3 text-sm">
              <b>Using keys from environment variables.</b> <span className="text-muted">Values saved here take priority.</span>
            </div>
          )}
          <SettingRow label="User key" hint="On your Pushover dashboard, top right.">
            <input className="input font-mono" value={user} onChange={(e) => setUser(e.target.value)} placeholder="30-character user key" />
          </SettingRow>
          <SettingRow label="App token" hint={<>Create an application at <a className="text-accent hover:underline" href="https://pushover.net/apps/build" target="_blank" rel="noreferrer">pushover.net/apps</a>.</>}>
            <input className="input font-mono" type="password" value={token} onChange={(e) => setToken(e.target.value)}
              placeholder={s.pushover_token_set ? "•••••••• (saved; type to replace)" : "30-character app token"} />
          </SettingRow>
          <SettingRow label="Public URL" hint="Optional. Lets notifications link back here, like http://servicehub.lan:8080.">
            <input className="input font-mono" value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} placeholder={origin} />
          </SettingRow>
          <div className="flex items-center justify-end gap-2">
            {msg && <span className={`mr-auto text-sm ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</span>}
            <button className="btn-outline" disabled={!!busy || !s.pushover_configured} onClick={test}><Bell size={14} /> {busy === "test" ? "Sending…" : "Send test"}</button>
            <button className="btn-primary" disabled={!!busy} onClick={savePushover}>{busy === "save" ? "Saving…" : "Save"}</button>
          </div>
        </Card>

        <Card title="API access" description="A token for deploying and running services from the command line, CI or another tool.">
          <SettingRow label="Token" hint={s.api_token_created ? `Created ${absolute(s.api_token_created)}` : "No token yet."}>
            <div className="flex flex-wrap items-center gap-2">
              {s.api_token_hint && <span className="rounded bg-white/5 px-2 py-1 font-mono text-xs text-muted">{s.api_token_hint}</span>}
              <button className="btn-outline py-1.5" onClick={makeToken}><KeyRound size={14} /> {s.api_token_hint ? "Make a new token" : "Create token"}</button>
              {s.api_token_hint && <button className="btn-danger py-1.5" onClick={revoke}><Trash2 size={14} /> Revoke</button>}
            </div>
          </SettingRow>
          {newToken && (
            <div className="grid gap-2 rounded-lg border border-warn/30 bg-warn/5 px-4 py-3">
              <div className="text-xs text-warn">Copy this now. ServiceHub only stores a hash, so it can't show it again.</div>
              <CopyBlock text={newToken} />
            </div>
          )}
          <div className="grid gap-2">
            <div className="text-[11px] font-semibold tracking-widest text-faint uppercase">Examples</div>
            <CopyBlock text={curlDeploy} />
            <CopyBlock text={curlSingle} />
            <CopyBlock text={curlRun} />
            <div className="text-[11px] text-faint">
              <span className="font-mono">/api/deploy/&lt;name&gt;</span> replaces the code, saves a version and restarts the service. Pass <span className="font-mono">type</span> the first time to create it. Full API docs are at <a className="text-accent hover:underline" href="/api/docs" target="_blank" rel="noreferrer">/api/docs</a>.
            </div>
          </div>
        </Card>

        <Card title="About">
          <SettingRow label="Version"><div className="pt-2 font-mono text-sm">{s.version}</div></SettingRow>
          <SettingRow label="Time zone" hint="Set with TZ in your compose file. Schedules use it."><div className="pt-2 font-mono text-sm">{s.tz}</div></SettingRow>
          <SettingRow label="Data folder" hint="Mount this as a volume so services survive container updates."><div className="pt-2 font-mono text-sm">{s.data_dir}</div></SettingRow>
          <SettingRow label="Password" hint="Set with SERVICEHUB_PASSWORD.">
            <div className="pt-2 text-sm">{s.auth_enabled ? <span className="text-up">Required</span> : <span className="text-warn">Not set, so access is open</span>}</div>
          </SettingRow>
        </Card>
      </div>
    </>
  );
}
