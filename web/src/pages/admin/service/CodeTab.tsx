import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { tags as t } from "@lezer/highlight";
import { createTheme } from "@uiw/codemirror-themes";
import CodeMirror from "@uiw/react-codemirror";
import clsx from "clsx";
import { Download, File, FilePlus2, FileText, Pencil, Play, Rocket, Save, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "../../../components/ui";
import { api, enc, type FileEntry, type Service } from "../../../lib/api";
import { useLoad } from "../../../lib/hooks";
import { bytes } from "../../../lib/time";

const theme = createTheme({
  theme: "dark",
  settings: {
    background: "#0c0f15",
    foreground: "#dfe4ee",
    caret: "#5b8cff",
    selection: "#5b8cff40",
    selectionMatch: "#5b8cff26",
    lineHighlight: "#ffffff06",
    gutterBackground: "#0c0f15",
    gutterForeground: "#5d6579",
    gutterBorder: "transparent",
  },
  styles: [
    { tag: [t.comment, t.lineComment, t.blockComment], color: "#5d6579", fontStyle: "italic" },
    { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: "#a78bfa" },
    { tag: [t.string, t.special(t.string)], color: "#9fd6a4" },
    { tag: [t.number, t.bool, t.null], color: "#f5c76b" },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#7aa2ff" },
    { tag: [t.definition(t.variableName), t.className, t.typeName], color: "#7dd3fc" },
    { tag: [t.tagName], color: "#f472b6" },
    { tag: [t.attributeName, t.propertyName], color: "#93c5fd" },
    { tag: [t.operator, t.punctuation], color: "#8b94a8" },
    { tag: [t.heading], color: "#eef1f7", fontWeight: "600" },
    { tag: [t.link, t.url], color: "#7aa2ff", textDecoration: "underline" },
  ],
});

function langFor(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "py": return [python()];
    case "html": case "htm": return [html()];
    case "js": case "mjs": case "jsx": return [javascript({ jsx: true })];
    case "ts": case "tsx": return [javascript({ jsx: true, typescript: true })];
    case "css": return [css()];
    case "json": return [json()];
    case "md": return [markdown()];
    default: return [];
  }
}

type Open = { path: string; content: string | null; original: string | null; binary: boolean };

export function CodeTab({ s, onDeploy }: { s: Service; onDeploy: () => void }) {
  const filesQ = useLoad(() => api.get<FileEntry[]>(`/api/services/${s.slug}/files`), [s.slug, s.current_version]);
  const [open, setOpen] = useState<Open | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [dragging, setDragging] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const dirty = !!open && !open.binary && open.content !== open.original;

  const load = useCallback(async (path: string) => {
    const r = await api.get<{ path: string; content: string | null; binary: boolean }>(`/api/services/${s.slug}/file?path=${enc(path)}`);
    setOpen({ path: r.path, content: r.content, original: r.content, binary: r.binary });
  }, [s.slug]);

  // Open the entrypoint (or first file) on load
  useEffect(() => {
    const list = filesQ.data;
    if (!list || open) return;
    const first = list.find((f) => f.path === s.entrypoint) ?? list[0];
    if (first) load(first.path).catch(() => {});
  }, [filesQ.data, open, s.entrypoint, load]);

  // Reload the open file after a rollback
  useEffect(() => {
    setOpen(null);
  }, [s.current_version]);

  const select = async (path: string) => {
    if (dirty && !confirm(`Discard unsaved changes to ${open!.path}?`)) return;
    await load(path);
  };

  const save = useCallback(async () => {
    if (!open || open.binary || open.content === null) return;
    setSaving(true);
    try {
      await api.put(`/api/services/${s.slug}/file`, { path: open.path, content: open.content });
      setOpen((o) => (o ? { ...o, original: o.content } : o));
      setMsg("Saved");
      setTimeout(() => setMsg(""), 1500);
      filesQ.reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [open, s.slug, filesQ]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [save]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const newFile = async () => {
    const path = prompt("New file name (folders allowed, like static/app.js):");
    if (!path) return;
    try {
      await api.put(`/api/services/${s.slug}/file`, { path, content: "" });
      await filesQ.reload();
      await load(path);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const rename = async () => {
    if (!open) return;
    const dst = prompt("Rename to:", open.path);
    if (!dst || dst === open.path) return;
    try {
      await api.post(`/api/services/${s.slug}/file/rename`, { src: open.path, dst });
      if (open.path === s.entrypoint && confirm(`Make ${dst} the entrypoint too?`)) {
        await api.patch(`/api/services/${s.slug}`, { entrypoint: dst });
      }
      await filesQ.reload();
      await load(dst);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const remove = async () => {
    if (!open) return;
    if (!confirm(`Delete ${open.path}? You can get it back by rolling back to an earlier version.`)) return;
    await api.del(`/api/services/${s.slug}/file?path=${enc(open.path)}`);
    setOpen(null);
    filesQ.reload();
  };

  const upload = async (list: FileList | File[]) => {
    const arr = Array.from(list);
    if (!arr.length) return;
    const fd = new FormData();
    arr.forEach((f) => fd.append("uploads", f));
    fd.append("paths", JSON.stringify(arr.map((f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name)));
    try {
      const r = await api.post<{ written: string[] }>(`/api/services/${s.slug}/upload`, fd);
      setMsg(`Uploaded ${r.written.length} file(s)`);
      setTimeout(() => setMsg(""), 2500);
      await filesQ.reload();
      if (open && r.written.includes(open.path)) await load(open.path);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const tree = useMemo(() => {
    const list = filesQ.data ?? [];
    return [...list].sort((a, b) => {
      const da = a.path.includes("/") ? 1 : 0, db = b.path.includes("/") ? 1 : 0;
      return da - db || a.path.localeCompare(b.path);
    });
  }, [filesQ.data]);

  const liveHint =
    s.type === "static" ? "Saved changes are live right away." :
    s.type === "script" ? "Saved changes apply to the next run." :
    "Saved changes apply after you deploy (which restarts it).";

  return (
    <div
      className="relative flex h-full min-h-[500px]"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files); }}
    >
      <aside className="flex w-56 shrink-0 flex-col border-r border-line">
        <div className="flex items-center gap-1 border-b border-line px-3 py-2">
          <span className="flex-1 text-[10px] font-semibold tracking-widest text-faint uppercase">Files</span>
          <button className="btn-ghost p-1.5" title="New file" onClick={newFile}><FilePlus2 size={14} /></button>
          <button className="btn-ghost p-1.5" title="Upload files or a .zip" onClick={() => uploadRef.current?.click()}><Upload size={14} /></button>
          <input ref={uploadRef} type="file" multiple hidden onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = ""; }} />
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {filesQ.loading && !filesQ.data && <Spinner className="m-3" />}
          {tree.map((f) => (
            <button key={f.path} onClick={() => select(f.path)} title={`${f.path} · ${bytes(f.size)}`}
              className={clsx("flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] transition",
                open?.path === f.path ? "bg-accent/15 text-fg" : "text-muted hover:bg-white/5 hover:text-fg")}>
              {f.path === s.entrypoint ? <Play size={12} className="shrink-0 text-accent" /> : f.path.match(/\.(py|js|ts|html|css|json|md|txt)$/) ? <FileText size={12} className="shrink-0" /> : <File size={12} className="shrink-0" />}
              <span className="truncate font-mono text-xs">{f.path}</span>
            </button>
          ))}
          {filesQ.data?.length === 0 && <div className="px-2 py-3 text-xs text-faint">No files yet. Create one or drop files here.</div>}
        </div>
        <div className="border-t border-line px-3 py-2 text-[11px] text-faint">
          <Play size={10} className="mr-1 inline text-accent" />marks the entrypoint. Drop files or a .zip anywhere here to upload.
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2">
          <span className="truncate font-mono text-xs">{open?.path ?? "—"}</span>
          {dirty && <span className="size-1.5 shrink-0 rounded-full bg-warn" title="Unsaved changes" />}
          {open && (
            <>
              <button className="btn-ghost p-1" title="Rename" onClick={rename}><Pencil size={13} /></button>
              <button className="btn-ghost p-1 hover:text-down" title="Delete file" onClick={remove}><Trash2 size={13} /></button>
            </>
          )}
          <span className="ml-auto text-[11px] text-faint">{msg ? <span className="text-up">{msg}</span> : liveHint}</span>
          <button className="btn-outline py-1 text-xs" disabled={!dirty || saving} onClick={save}>
            <Save size={13} /> {saving ? "Saving…" : "Save"} <span className="kbd">⌘S</span>
          </button>
          <button className={clsx(s.status.dirty && !dirty ? "btn-primary" : "btn-outline", "py-1 text-xs")} onClick={onDeploy}>
            <Rocket size={13} /> Deploy
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {!open ? (
            <div className="grid h-full place-items-center text-sm text-faint">Pick a file on the left.</div>
          ) : open.binary ? (
            <div className="grid h-full place-items-center text-center text-sm text-muted">
              <div className="grid justify-items-center gap-3">
                This file is binary or too large to edit here.
                <a className="btn-outline py-1 text-xs" href={`/api/services/${s.slug}/raw?path=${enc(open.path)}`}><Download size={13} /> Download</a>
              </div>
            </div>
          ) : (
            <CodeMirror
              key={open.path}
              value={open.content ?? ""}
              height="100%"
              className="h-full"
              theme={theme}
              extensions={langFor(open.path)}
              onChange={(v) => setOpen((o) => (o ? { ...o, content: v } : o))}
              basicSetup={{ tabSize: 4, foldGutter: true, highlightActiveLine: true }}
            />
          )}
        </div>
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-xl border-2 border-dashed border-accent/60 bg-accent/5 text-sm text-fg">
          Drop to upload into {s.name}. Zips are unpacked.
        </div>
      )}
    </div>
  );
}
