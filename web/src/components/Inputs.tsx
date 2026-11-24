import clsx from "clsx";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { InputSpec } from "../lib/api";

export type InputValues = Record<string, string | number | boolean>;

export function defaults(specs: InputSpec[]): InputValues {
  const v: InputValues = {};
  for (const s of specs) {
    if (s.type === "checkbox") v[s.name] = s.default === true || s.default === "true";
    else v[s.name] = (s.default ?? "") as string;
  }
  return v;
}

/** The run form shown on the launcher and in admin. */
export function InputForm({ specs, values, onChange, glass, onSubmit }: {
  specs: InputSpec[];
  values: InputValues;
  onChange: (v: InputValues) => void;
  glass?: boolean;
  onSubmit?: () => void;
}) {
  if (!specs.length) return null;
  const cls = clsx("input", glass && "border-white/10 bg-black/25");
  const set = (k: string, val: string | number | boolean) => onChange({ ...values, [k]: val });
  const enter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement) && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  };
  return (
    <div className="grid gap-3" onKeyDown={enter}>
      {specs.map((s) => {
        const label = s.label || s.name;
        const v = values[s.name];
        return (
          <div key={s.name}>
            {s.type === "checkbox" ? (
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" className="accent-accent" checked={!!v} onChange={(e) => set(s.name, e.target.checked)} />
                {label}
              </label>
            ) : (
              <>
                <label className={clsx("label", glass && "text-white/50")}>
                  {label}
                  {s.required && <span className="text-down"> *</span>}
                </label>
                {s.type === "textarea" ? (
                  <textarea className={clsx(cls, "min-h-24 font-mono text-[13px]")} value={String(v ?? "")} onChange={(e) => set(s.name, e.target.value)} />
                ) : s.type === "select" ? (
                  <select className={cls} value={String(v ?? "")} onChange={(e) => set(s.name, e.target.value)}>
                    {!s.required && <option value="">—</option>}
                    {s.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input
                    className={cls}
                    type={s.type === "number" ? "number" : s.type === "password" ? "password" : "text"}
                    value={String(v ?? "")}
                    onChange={(e) => set(s.name, e.target.value)}
                  />
                )}
              </>
            )}
            {s.help && <div className={clsx("mt-1 text-[11px]", glass ? "text-white/40" : "text-faint")}>{s.help}</div>}
          </div>
        );
      })}
    </div>
  );
}

const TYPES: InputSpec["type"][] = ["text", "textarea", "number", "select", "checkbox", "password"];

/** Admin editor for a script's input definitions. */
export function InputsEditor({ value, onChange }: { value: InputSpec[]; onChange: (v: InputSpec[]) => void }) {
  const update = (i: number, p: Partial<InputSpec>) => onChange(value.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, d: number) => {
    const next = [...value];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x);
    onChange(next);
  };
  const add = () =>
    onChange([...value, { name: `input_${value.length + 1}`, label: "", type: "text", default: "", required: false, help: "", options: [] }]);

  return (
    <div className="grid gap-2">
      {value.length === 0 && <div className="text-sm text-muted">No inputs. The Run button starts the script straight away.</div>}
      {value.map((s, i) => (
        <div key={i} className="grid gap-2 rounded-md border border-line bg-black/15 p-3">
          <div className="grid gap-2 md:grid-cols-[1fr_1fr_140px_auto]">
            <div>
              <label className="label">Name</label>
              <input className="input font-mono" value={s.name} onChange={(e) => update(i, { name: e.target.value.replace(/[^A-Za-z0-9_]/g, "_") })} />
            </div>
            <div>
              <label className="label">Label</label>
              <input className="input" placeholder={s.name} value={s.label} onChange={(e) => update(i, { label: e.target.value })} />
            </div>
            <div>
              <label className="label">Type</label>
              <select className="input" value={s.type} onChange={(e) => update(i, { type: e.target.value as InputSpec["type"] })}>
                {TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex items-end gap-0.5">
              <button className="btn-ghost p-1.5" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
              <button className="btn-ghost p-1.5" title="Move down" disabled={i === value.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
              <button className="btn-danger p-1.5" title="Remove input" onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
            <div>
              <label className="label">Default</label>
              {s.type === "checkbox" ? (
                <select className="input" value={String(s.default === true || s.default === "true")} onChange={(e) => update(i, { default: e.target.value === "true" })}>
                  <option value="false">Unchecked</option>
                  <option value="true">Checked</option>
                </select>
              ) : (
                <input className="input" value={String(s.default ?? "")} onChange={(e) => update(i, { default: e.target.value })} />
              )}
            </div>
            <div>
              <label className="label">Help text</label>
              <input className="input" value={s.help} onChange={(e) => update(i, { help: e.target.value })} />
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm text-muted">
              <input type="checkbox" className="accent-accent" checked={s.required} onChange={(e) => update(i, { required: e.target.checked })} />
              Required
            </label>
          </div>
          {s.type === "select" && (
            <div>
              <label className="label">Options</label>
              <input className="input" placeholder="small, medium, large" value={s.options.join(", ")}
                onChange={(e) => update(i, { options: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
              <div className="mt-1 text-[11px] text-faint">Comma-separated.</div>
            </div>
          )}
          <div className="text-[11px] text-faint">
            Your script reads this as <span className="font-mono text-muted">os.environ["INPUT_{s.name.toUpperCase()}"]</span>.
          </div>
        </div>
      ))}
      <div>
        <button className="btn-outline py-1 text-xs" onClick={add}><Plus size={13} /> Add input</button>
      </div>
    </div>
  );
}

/** Key/value editor for environment variables. */
export function EnvEditor({ value, onChange }: { value: [string, string][]; onChange: (v: [string, string][]) => void }) {
  const update = (i: number, k: string, v: string) => onChange(value.map((row, j) => (j === i ? [k, v] : row)));
  return (
    <div className="grid gap-2">
      {value.length === 0 && <div className="text-sm text-muted">No environment variables.</div>}
      {value.map(([k, v], i) => (
        <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] gap-2">
          <input className="input font-mono text-[13px]" placeholder="API_KEY" value={k}
            onChange={(e) => update(i, e.target.value.replace(/[^A-Za-z0-9_]/g, "_"), v)} />
          <input className="input font-mono text-[13px]" placeholder="value" value={v} onChange={(e) => update(i, k, e.target.value)} />
          <button className="btn-danger p-1.5" title="Remove" onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
        </div>
      ))}
      <div>
        <button className="btn-outline py-1 text-xs" onClick={() => onChange([...value, ["", ""]])}><Plus size={13} /> Add variable</button>
      </div>
    </div>
  );
}
