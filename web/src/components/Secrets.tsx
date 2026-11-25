import clsx from "clsx";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type SharedSecret } from "../lib/api";
import { useLoad } from "../lib/hooks";
import { relative } from "../lib/time";
import { Card, Empty, ErrorNote } from "./ui";

/** Settings page: create, replace and delete shared secrets. Values are write-only. */
export function SharedSecretsCard() {
  const list = useLoad(() => api.get<SharedSecret[]>("/api/secrets"), []);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const put = async (n: string, v: string) => {
    setBusy(true);
    setErr("");
    try {
      await api.put(`/api/secrets/${encodeURIComponent(n)}`, { value: v });
      await list.reload();
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (list.data?.some((s) => s.name === name.trim()) && !confirm(`${name.trim()} already exists. Replace its value?`)) return;
    if (await put(name.trim(), value)) {
      setName("");
      setValue("");
    }
  };

  const del = async (s: SharedSecret) => {
    const users = s.used_by.length ? ` It's removed from ${s.used_by.map((u) => u.name).join(", ")}.` : "";
    if (!confirm(`Delete ${s.name}?${users}`)) return;
    setErr("");
    try {
      await api.del(`/api/secrets/${encodeURIComponent(s.name)}`);
      await list.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <Card
      title="Shared secrets"
      description="Define an API key or setting once and attach it to any service in its Settings tab. It arrives as an environment variable. Values can be replaced but never shown again."
    >
      {list.data && list.data.length === 0 && <Empty icon={KeyRound}>No shared secrets yet. Add one below.</Empty>}
      {list.data && list.data.length > 0 && (
        <div className="overflow-hidden rounded-md border border-line">
          {list.data.map((s) => (
            <div key={s.name} className="grid gap-2 border-b border-line px-4 py-3 last:border-b-0">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-sm">{s.name}</span>
                <span className="font-mono text-xs text-faint">••••••••</span>
                <span className="text-xs text-faint">updated {relative(s.updated_at)}</span>
                <div className="ml-auto flex items-center gap-1">
                  <button className="btn-ghost py-1 text-xs" onClick={() => { setEditing(editing === s.name ? null : s.name); setEditValue(""); }}>Replace</button>
                  <button className="btn-danger p-1.5" title="Delete" onClick={() => del(s)}><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="text-xs text-muted">
                {s.used_by.length === 0 ? "Not used by any service yet." : (
                  <>Used by {s.used_by.map((u, i) => (
                    <span key={u.slug}>{i > 0 && ", "}<Link className="text-accent hover:underline" to={`/admin/services/${u.slug}/settings`}>{u.name}</Link></span>
                  ))}</>
                )}
              </div>
              {editing === s.name && (
                <form className="flex flex-wrap gap-2" onSubmit={async (e) => { e.preventDefault(); if (await put(s.name, editValue)) setEditing(null); }}>
                  <input autoFocus type="password" autoComplete="off" className="input max-w-sm font-mono" placeholder="New value" value={editValue} onChange={(e) => setEditValue(e.target.value)} />
                  <button className="btn-primary" disabled={busy}>Save</button>
                  <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <label className="label">Name</label>
          <input className="input font-mono" placeholder="OPENWEATHER_KEY" value={name} onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))} />
        </div>
        <div className="min-w-48 flex-[2]">
          <label className="label">Value</label>
          <input type="password" autoComplete="off" className="input font-mono" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <button className="btn-primary" disabled={busy || !name.trim()}><Plus size={14} /> Add secret</button>
      </form>
      <ErrorNote>{err}</ErrorNote>
    </Card>
  );
}

/** Service settings: choose which shared secrets this service gets. */
export function SecretPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const list = useLoad(() => api.get<SharedSecret[]>("/api/secrets"), []);
  if (!list.data) return null;
  if (list.data.length === 0) {
    return <div className="pt-2 text-sm text-muted">No shared secrets yet. Add them in <Link className="text-accent hover:underline" to="/admin/settings">Settings</Link>.</div>;
  }
  const toggle = (n: string) => onChange(value.includes(n) ? value.filter((x) => x !== n) : [...value, n].sort());
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {list.data.map((s) => {
        const on = value.includes(s.name);
        return (
          <button key={s.name} type="button" onClick={() => toggle(s.name)} aria-pressed={on}
            className={clsx("flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-xs transition",
              on ? "border-accent/60 bg-accent/10 text-fg" : "border-line-2 text-muted hover:text-fg")}>
            <KeyRound size={12} className={on ? "text-accent" : "text-faint"} />
            {s.name}
          </button>
        );
      })}
    </div>
  );
}
