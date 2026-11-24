import clsx from "clsx";
import { Clock, FileCode2, Globe, Loader2, Repeat, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import type { ServiceStatus, ServiceType } from "../lib/api";

/* ---------- logo ---------- */

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="sh-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#60a5fa" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="#0b0d12" />
      <rect x="6" y="6" width="9" height="9" rx="2.5" fill="url(#sh-logo)" />
      <rect x="17" y="6" width="9" height="9" rx="2.5" fill="url(#sh-logo)" opacity=".7" />
      <rect x="6" y="17" width="9" height="9" rx="2.5" fill="url(#sh-logo)" opacity=".7" />
      <rect x="17" y="17" width="9" height="9" rx="2.5" fill="url(#sh-logo)" opacity=".45" />
    </svg>
  );
}

/* ---------- types & status ---------- */

export const TYPE_META: Record<ServiceType, { label: string; icon: LucideIcon; blurb: string }> = {
  static: { label: "Static page", icon: Globe, blurb: "HTML, JS and CSS served as-is at /s/name/." },
  script: { label: "Script", icon: Clock, blurb: "Python that runs on a schedule or when you press Run." },
  worker: { label: "Worker", icon: Repeat, blurb: "Python that runs all the time and restarts if it crashes." },
  webapp: { label: "Web app", icon: FileCode2, blurb: "A Python web server (Flask, FastAPI…) served at /s/name/." },
};

export function TypeChip({ type }: { type: ServiceType }) {
  const M = TYPE_META[type];
  return (
    <span className="inline-flex items-center gap-1 rounded bg-white/5 px-1.5 py-px text-[11px] text-muted">
      <M.icon size={11} />
      {M.label}
    </span>
  );
}

export type DotKind = "up" | "down" | "pending" | "maintenance" | "paused" | "unknown";

export function statusInfo(type: ServiceType, st: ServiceStatus): { dot: DotKind; label: string; busy?: boolean } {
  switch (st.state) {
    case "disabled":
      return { dot: "paused", label: "Disabled" };
    case "up":
      return { dot: "up", label: "Live" };
    case "running":
      return type === "script" ? { dot: "maintenance", label: "Running", busy: true } : { dot: "up", label: "Running" };
    case "ok":
      return { dot: "up", label: "Last run OK" };
    case "failing":
      return { dot: "down", label: st.last_run?.status === "timeout" ? "Last run timed out" : "Last run failed" };
    case "idle":
      return { dot: "unknown", label: "Never run" };
    case "installing":
      return { dot: "pending", label: "Installing", busy: true };
    case "starting":
      return { dot: "pending", label: "Starting", busy: true };
    case "backoff":
      return { dot: "pending", label: "Restarting" };
    case "failed":
      return { dot: "down", label: "Crashed" };
    case "stopped":
      return { dot: "paused", label: "Stopped" };
    default:
      return { dot: "unknown", label: st.detail || "No data" };
  }
}

const DOT: Record<DotKind, string> = {
  up: "bg-up shadow-[0_0_8px_var(--color-up)]",
  down: "bg-down dot-down",
  pending: "bg-warn",
  maintenance: "bg-maint",
  paused: "bg-faint",
  unknown: "border border-white/30 bg-transparent",
};

export function StatusDot({ kind, title, small }: { kind: DotKind; title: string; small?: boolean }) {
  return <span title={title} className={clsx("inline-block shrink-0 rounded-full", small ? "size-2" : "size-2.5", DOT[kind])} />;
}

const PILL: Record<DotKind, string> = {
  up: "bg-up/15 text-up",
  down: "bg-down/15 text-down",
  pending: "bg-warn/15 text-warn",
  maintenance: "bg-accent/15 text-accent",
  paused: "bg-white/5 text-faint",
  unknown: "bg-white/10 text-muted",
};

export function StatusPill({ type, status }: { type: ServiceType; status: ServiceStatus }) {
  const i = statusInfo(type, status);
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium", PILL[i.dot])}>
      {i.busy && <Loader2 size={11} className="animate-spin" />}
      {i.label}
    </span>
  );
}

/* ---------- service icon ---------- */

function hashHue(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

export function ServiceIcon({ name, icon, className }: { name: string; icon: string; className?: string }) {
  if (icon) {
    return <div className={clsx("grid place-items-center rounded-xl bg-white/5 leading-none", className)}>{icon}</div>;
  }
  const initials = name
    .split(/[\s-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const hue = hashHue(name);
  const c = `hsl(${hue} 70% 58%)`;
  const c2 = `hsl(${(hue + 40) % 360} 70% 48% / 0.55)`;
  return (
    <div
      className={clsx("grid place-items-center rounded-xl font-semibold text-white/90", className)}
      style={{ background: `linear-gradient(140deg, ${c}, ${c2})` }}
    >
      {initials || "?"}
    </div>
  );
}

/* ---------- layout ---------- */

export function PageHeader({ title, subtitle, actions, leading }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; leading?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-6 py-4">
      <div className="flex min-w-0 items-center gap-3">
        {leading}
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, description, actions, children, className, bodyClassName }: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx("rounded-lg border border-line bg-panel", className)}>
      {title && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={clsx("grid gap-4 p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function SettingRow({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid items-start gap-2 md:grid-cols-[220px_1fr] md:gap-4">
      <div className="pt-2">
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-faint">{hint}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <div className="mt-1 text-[11px] text-faint">{hint}</div>}
    </div>
  );
}

/* ---------- controls ---------- */

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={clsx("relative h-5 w-9 shrink-0 rounded-full transition duration-200 disabled:opacity-50", on ? "bg-accent" : "bg-line-2")}
    >
      <span className={clsx("absolute top-0.5 size-4 rounded-full bg-white transition-all duration-200", on ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, className }: {
  value: T;
  options: { value: T; label: ReactNode; count?: number }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="radiogroup" className={clsx("flex w-fit flex-wrap rounded-md border border-line p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition",
            o.value === value ? "bg-white/10 text-fg" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
          {o.count != null && o.count > 0 && <span className="text-[10px] tabular-nums text-faint">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------- modal ---------- */

export function Modal({ title, onClose, children, footer, width = "max-w-lg" }: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && ref.current();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh] backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal className={clsx("pop-in w-full rounded-xl border border-line-2 bg-panel shadow-2xl", width)}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button className="btn-ghost -mr-2 p-1.5" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- states ---------- */

export function Empty({ icon: Icon, children, action }: { icon: LucideIcon; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid justify-items-center gap-2 rounded-lg border border-dashed border-line-2 px-6 py-10 text-center text-sm text-muted">
      <Icon size={26} className="text-faint" />
      <div className="max-w-md">{children}</div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <div className="rounded-md border border-down/40 bg-down/10 px-4 py-2 text-sm text-down">{children}</div>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 size={16} className={clsx("animate-spin text-accent", className)} />;
}

export function Dash() {
  return <span className="text-faint">—</span>;
}
