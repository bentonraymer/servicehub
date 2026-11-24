export function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

export function relative(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return "—";
  const diff = (d.getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const fmt = (n: number, u: string) => (diff < 0 ? `${n}${u} ago` : `in ${n}${u}`);
  if (abs < 45) return diff < 0 ? "just now" : "in a few seconds";
  if (abs < 3600) return fmt(Math.round(abs / 60), "m");
  if (abs < 86400) return fmt(Math.round(abs / 3600), "h");
  if (abs < 86400 * 60) return fmt(Math.round(abs / 86400), "d");
  return absolute(iso);
}

export function absolute(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return "—";
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function duration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${Math.round(s % 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function uptime(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return "—";
  return duration(Date.now() - d.getTime());
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
