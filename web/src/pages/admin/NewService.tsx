import clsx from "clsx";
import { Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Field, Modal, TYPE_META } from "../../components/ui";
import { api, type Group, type Service, type ServiceType } from "../../lib/api";

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

export function NewServiceModal({ onClose, groups }: { onClose: () => void; groups: Group[] }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [type, setType] = useState<ServiceType>("static");
  const [groupId, setGroupId] = useState<string>("");
  const [source, setSource] = useState<"template" | "upload">("template");
  const [uploads, setUploads] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const effSlug = slugTouched ? slug : slugify(name);

  const guessedEntry = useMemo(() => {
    const names = uploads.map((f) => f.name);
    if (type === "static") return names.find((n) => n.endsWith(".html"));
    return names.find((n) => n.endsWith(".py"));
  }, [uploads, type]);

  const create = async () => {
    setBusy(true);
    setErr("");
    try {
      const s = await api.post<Service>("/api/services", {
        name, type, slug: effSlug || undefined, group_id: groupId ? +groupId : null, template: source === "template",
      });
      if (source === "upload" && uploads.length) {
        const fd = new FormData();
        uploads.forEach((f) => fd.append("uploads", f));
        fd.append("paths", JSON.stringify(uploads.map((f) => f.name)));
        await api.post(`/api/services/${s.slug}/upload`, fd);
        if (guessedEntry && !uploads.some((f) => f.name.endsWith(".zip"))) {
          await api.patch(`/api/services/${s.slug}`, { entrypoint: guessedEntry });
        }
        await api.post(`/api/services/${s.slug}/deploy`, { note: "Initial upload" });
      }
      nav(`/admin/services/${s.slug}/${source === "template" ? "code" : "overview"}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New service"
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          {err && <span className="mr-auto text-sm text-down">{err}</span>}
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!name.trim() || busy || (source === "upload" && !uploads.length)} onClick={create}>
            {busy ? "Creating…" : "Create service"}
          </button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(TYPE_META) as ServiceType[]).map((t) => {
            const M = TYPE_META[t];
            return (
              <button key={t} type="button" onClick={() => setType(t)}
                className={clsx("rounded-md border px-3 py-2 text-left transition", type === t ? "border-accent bg-accent/10" : "border-line hover:border-line-2")}>
                <div className="flex items-center gap-2 text-sm font-medium"><M.icon size={14} className="text-muted" />{M.label}</div>
                <div className="mt-0.5 text-[11px] text-muted">{M.blurb}</div>
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input autoFocus className="input" placeholder="Tip calculator" value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && name.trim() && source === "template" && create()} />
          </Field>
          <Field label="URL name" hint={type === "static" || type === "webapp" ? <>Served at <span className="font-mono">/s/{effSlug || "name"}/</span></> : "Used in the API and folder names"}>
            <input className="input font-mono" placeholder="tip-calculator" value={effSlug}
              onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }} />
          </Field>
        </div>
        <Field label="Launcher section">
          <select className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">No section</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
        <div>
          <label className="label">Start from</label>
          <div className="flex rounded-md border border-line p-0.5 w-fit">
            {(["template", "upload"] as const).map((v) => (
              <button key={v} onClick={() => setSource(v)} className={clsx("rounded px-2.5 py-1 text-xs", source === v ? "bg-white/10 text-fg" : "text-muted hover:text-fg")}>
                {v === "template" ? "Starter template" : "Upload files"}
              </button>
            ))}
          </div>
        </div>
        {source === "upload" && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); setUploads([...uploads, ...Array.from(e.dataTransfer.files)]); }}
            onClick={() => fileRef.current?.click()}
            className="grid cursor-pointer justify-items-center gap-1.5 rounded-lg border-2 border-dashed border-line-2 px-4 py-6 text-center text-sm text-muted transition hover:border-accent/50"
          >
            <Upload size={20} className="text-faint" />
            {uploads.length ? (
              <div className="font-mono text-xs text-fg">{uploads.map((f) => f.name).join(", ")}</div>
            ) : (
              <>Drop files or a .zip here, or click to choose.</>
            )}
            {guessedEntry && <div className="text-[11px] text-faint">Entrypoint will be <span className="font-mono">{guessedEntry}</span></div>}
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => setUploads([...uploads, ...Array.from(e.target.files ?? [])])} />
          </div>
        )}
      </div>
    </Modal>
  );
}
