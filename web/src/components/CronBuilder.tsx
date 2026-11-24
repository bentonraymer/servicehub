import clsx from "clsx";
import { CalendarClock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, enc } from "../lib/api";
import { Segmented } from "./ui";

type Mode = "off" | "minutes" | "hourly" | "daily" | "weekly" | "monthly" | "custom";

type State = {
  mode: Mode;
  everyMin: number;
  everyHour: number;
  minute: number;
  time: string; // HH:MM
  days: number[]; // 0=Sun … 6=Sat
  dom: number;
  custom: string;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MIN_STEPS = [1, 2, 5, 10, 15, 20, 30];
const HOUR_STEPS = [1, 2, 3, 4, 6, 8, 12];

const PRESETS: { label: string; expr: string }[] = [
  { label: "Every 5 minutes", expr: "*/5 * * * *" },
  { label: "Every hour", expr: "0 * * * *" },
  { label: "Every morning at 7", expr: "0 7 * * *" },
  { label: "Weekdays at 9", expr: "0 9 * * 1-5" },
  { label: "Sundays at 8 PM", expr: "0 20 * * 0" },
  { label: "1st of the month", expr: "0 6 1 * *" },
];

const pad = (n: number) => String(n).padStart(2, "0");

function toCron(s: State): string {
  const [hh, mm] = s.time.split(":").map((x) => parseInt(x, 10) || 0);
  switch (s.mode) {
    case "off":
      return "";
    case "minutes":
      return s.everyMin === 1 ? "* * * * *" : `*/${s.everyMin} * * * *`;
    case "hourly":
      return `${s.minute} ${s.everyHour === 1 ? "*" : `*/${s.everyHour}`} * * *`;
    case "daily":
      return `${mm} ${hh} * * *`;
    case "weekly":
      return `${mm} ${hh} * * ${s.days.length ? compactDays(s.days) : "*"}`;
    case "monthly":
      return `${mm} ${hh} ${s.dom} * *`;
    case "custom":
      return s.custom.trim();
  }
}

function compactDays(days: number[]): string {
  const d = [...new Set(days)].sort((a, b) => a - b);
  if (d.join(",") === "1,2,3,4,5") return "1-5";
  if (d.join(",") === "0,6") return "0,6";
  return d.join(",");
}

function expandDays(field: string): number[] | null {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const m = part.match(/^(\d)(?:-(\d))?$/);
    if (!m) return null;
    const a = +m[1], b = m[2] ? +m[2] : a;
    for (let i = a; i <= b; i++) out.add(i % 7);
  }
  return [...out];
}

function fromCron(expr: string): State {
  const base: State = { mode: "off", everyMin: 15, everyHour: 1, minute: 0, time: "07:00", days: [1, 2, 3, 4, 5], dom: 1, custom: expr };
  const e = expr.trim();
  if (!e) return base;
  const f = e.split(/\s+/);
  if (f.length !== 5) return { ...base, mode: "custom" };
  const [mi, ho, dom, mon, dow] = f;
  const num = (x: string) => /^\d+$/.test(x);
  if (dom === "*" && mon === "*" && dow === "*") {
    if (ho === "*" && (mi === "*" || /^\*\/\d+$/.test(mi))) {
      const n = mi === "*" ? 1 : +mi.slice(2);
      if (MIN_STEPS.includes(n)) return { ...base, mode: "minutes", everyMin: n };
    }
    if (num(mi) && (ho === "*" || /^\*\/\d+$/.test(ho))) {
      const n = ho === "*" ? 1 : +ho.slice(2);
      if (HOUR_STEPS.includes(n)) return { ...base, mode: "hourly", everyHour: n, minute: +mi };
    }
    if (num(mi) && num(ho)) return { ...base, mode: "daily", time: `${pad(+ho)}:${pad(+mi)}` };
  }
  if (num(mi) && num(ho) && dom === "*" && mon === "*" && dow !== "*") {
    const days = expandDays(dow);
    if (days) return { ...base, mode: "weekly", time: `${pad(+ho)}:${pad(+mi)}`, days };
  }
  if (num(mi) && num(ho) && num(dom) && mon === "*" && dow === "*") {
    return { ...base, mode: "monthly", time: `${pad(+ho)}:${pad(+mi)}`, dom: +dom };
  }
  return { ...base, mode: "custom" };
}

type Preview = { valid: boolean; description?: string; next?: string[]; error?: string; tz?: string };

export function CronBuilder({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [s, setS] = useState<State>(() => fromCron(value));
  const [preview, setPreview] = useState<Preview | null>(null);
  const expr = useMemo(() => toCron(s), [s]);

  // Re-sync if the parent value changes from outside (e.g. discard)
  useEffect(() => {
    if (value !== expr) setS(fromCron(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    if (expr !== value) onChange(expr);
    if (!expr) {
      setPreview(null);
      return;
    }
    const t = setTimeout(() => {
      api.get<Preview>(`/api/cron/preview?expr=${enc(expr)}`).then(setPreview).catch(() => setPreview(null));
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expr]);

  const set = (p: Partial<State>) => setS((prev) => ({ ...prev, ...p, custom: p.custom ?? (p.mode === "custom" ? toCron(prev) || prev.custom : prev.custom) }));

  return (
    <div className="grid gap-3">
      <Segmented<Mode>
        value={s.mode}
        onChange={(mode) => set({ mode })}
        options={[
          { value: "off", label: "Off" },
          { value: "minutes", label: "Minutes" },
          { value: "hourly", label: "Hourly" },
          { value: "daily", label: "Daily" },
          { value: "weekly", label: "Weekly" },
          { value: "monthly", label: "Monthly" },
          { value: "custom", label: "Custom" },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        {s.mode === "off" && <span>Only runs when you press Run (or call the API).</span>}
        {s.mode === "minutes" && (
          <>
            Every
            <select className="input w-auto py-1 text-xs" value={s.everyMin} onChange={(e) => set({ everyMin: +e.target.value })}>
              {MIN_STEPS.map((n) => <option key={n} value={n}>{n === 1 ? "minute" : `${n} minutes`}</option>)}
            </select>
          </>
        )}
        {s.mode === "hourly" && (
          <>
            Every
            <select className="input w-auto py-1 text-xs" value={s.everyHour} onChange={(e) => set({ everyHour: +e.target.value })}>
              {HOUR_STEPS.map((n) => <option key={n} value={n}>{n === 1 ? "hour" : `${n} hours`}</option>)}
            </select>
            at minute
            <input type="number" min={0} max={59} className="input w-20 py-1 text-xs tabular-nums" value={s.minute}
              onChange={(e) => set({ minute: Math.min(59, Math.max(0, +e.target.value || 0)) })} />
          </>
        )}
        {(s.mode === "daily" || s.mode === "weekly" || s.mode === "monthly") && (
          <>
            {s.mode === "monthly" && (
              <>
                On day
                <select className="input w-auto py-1 text-xs" value={s.dom} onChange={(e) => set({ dom: +e.target.value })}>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </>
            )}
            {s.mode === "daily" ? "Every day at" : "at"}
            <input type="time" className="input w-auto py-1 text-xs tabular-nums" value={s.time} onChange={(e) => set({ time: e.target.value || "00:00" })} />
          </>
        )}
        {s.mode === "custom" && (
          <div className="w-full">
            <input className="input font-mono" placeholder="*/10 8-18 * * 1-5" value={s.custom} onChange={(e) => set({ custom: e.target.value })} />
            <div className="mt-1 text-[11px] text-faint">
              Five fields: <span className="font-mono">minute hour day-of-month month day-of-week</span>. Use <span className="font-mono">*</span> for any,{" "}
              <span className="font-mono">*/n</span> for every n, <span className="font-mono">a-b</span> for ranges, commas for lists.
            </div>
          </div>
        )}
      </div>

      {s.mode === "weekly" && (
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d, i) => {
            const on = s.days.includes(i);
            return (
              <button key={d} type="button"
                onClick={() => set({ days: on ? s.days.filter((x) => x !== i) : [...s.days, i] })}
                className={clsx("rounded-full border px-2.5 py-0.5 text-xs transition", on ? "border-accent bg-accent/15 text-fg" : "border-line-2 text-muted hover:text-fg")}>
                {d}
              </button>
            );
          })}
        </div>
      )}

      {(s.mode === "off" || s.mode === "custom") && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-faint">Quick picks:</span>
          {PRESETS.map((p) => (
            <button key={p.expr} type="button" onClick={() => setS(fromCron(p.expr))}
              className="rounded-full border border-line-2 px-2.5 py-0.5 text-xs text-muted transition hover:text-fg">
              {p.label}
            </button>
          ))}
        </div>
      )}

      {expr && (
        <div className="rounded-md border border-line bg-black/20 px-3 py-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarClock size={13} className="text-faint" />
            <span className="font-mono text-fg">{expr}</span>
            {preview?.valid && preview.description && <span className="text-muted">· {preview.description}</span>}
          </div>
          {preview && !preview.valid && <div className="mt-1.5 text-down">{preview.error}</div>}
          {preview?.valid && preview.next && (
            <div className="mt-2 grid gap-0.5 text-muted">
              <div className="text-[10px] font-semibold tracking-widest text-faint uppercase">Next runs ({preview.tz})</div>
              {preview.next.map((n) => (
                <div key={n} className="tabular-nums">
                  {new Date(n).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: preview.tz })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
