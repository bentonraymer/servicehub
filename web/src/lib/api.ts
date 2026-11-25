export type ServiceType = "static" | "script" | "worker" | "webapp";

export type InputSpec = {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "checkbox" | "password";
  default: string | number | boolean | null;
  required: boolean;
  help: string;
  options: string[];
};

export type RunSummary = {
  id: number;
  status: RunStatus;
  finished_at: string | null;
  started_at: string;
  duration_ms: number | null;
};

export type RunStatus = "running" | "success" | "failed" | "timeout" | "cancelled" | "interrupted";

export type ServiceStatus = {
  state: string;
  detail: string;
  dirty?: boolean;
  pid?: number | null;
  started_at?: string | null;
  restarts?: number;
  last_exit?: number | null;
  port?: number;
  last_run?: RunSummary | null;
  running_run?: number | null;
  next_run?: string | null;
};

export type Service = {
  id: number;
  slug: string;
  name: string;
  description: string;
  type: ServiceType;
  icon: string;
  group_id: number | null;
  position: number;
  show_on_launcher: boolean;
  enabled: boolean;
  entrypoint: string;
  schedule: string;
  timeout_seconds: number;
  inputs: InputSpec[];
  env: Record<string, string>;
  notify_on_failure: boolean;
  has_password: boolean;
  secrets: string[];
  webhook_token: string;
  tile: Tile | null;
  current_version: number;
  created_at: string;
  updated_at: string;
  status: ServiceStatus;
};

export type LauncherService = Pick<
  Service,
  "id" | "slug" | "name" | "description" | "type" | "icon" | "group_id" | "position" | "inputs" | "enabled" | "status" | "has_password" | "tile"
> & { locked: boolean };

export type Tile = { text: string; tone: "" | "up" | "down" | "warn"; t: string };

export type SharedSecret = { name: string; updated_at: string; used_by: { slug: string; name: string }[] };

export type Group = { id: number; name: string; position: number };

export type Run = {
  id: number;
  service_id: number;
  slug: string;
  name: string;
  trigger: string;
  status: RunStatus;
  exit_code: number | null;
  inputs: Record<string, unknown>;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
};

export type Version = {
  id: number;
  number: number;
  note: string;
  source: string;
  size: number;
  created_at: string;
};

export type FileEntry = { path: string; size: number; modified: number };

export type Settings = {
  pushover_user: string;
  pushover_token_set: boolean;
  pushover_from_env: boolean;
  pushover_configured: boolean;
  public_url: string;
  api_token_hint: string;
  api_token_created: string;
  auth_enabled: boolean;
  tz: string;
  data_dir: string;
  version: string;
  now: string;
};

export type LogLine = { t: string; s: "out" | "err" | "sys"; l: string };

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["content-type"] = "application/json";
  }
  const res = await fetch(path, init);
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = `/login?next=${next}`;
    throw new ApiError(401, "Sign in first.");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    let msg = res.statusText;
    if (data?.detail) {
      msg = typeof data.detail === "string" ? data.detail : data.detail.map((d: { msg: string }) => d.msg).join("; ");
    }
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>("GET", p),
  post: <T>(p: string, b?: unknown) => request<T>("POST", p, b ?? {}),
  put: <T>(p: string, b?: unknown) => request<T>("PUT", p, b),
  patch: <T>(p: string, b?: unknown) => request<T>("PATCH", p, b),
  del: <T>(p: string) => request<T>("DELETE", p),
};

export const enc = encodeURIComponent;
