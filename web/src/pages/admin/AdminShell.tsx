import clsx from "clsx";
import { AlertTriangle, History, LayoutGrid, LogOut, Rocket, Server, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Logo, statusInfo } from "../../components/ui";
import { api, type Service } from "../../lib/api";
import { useLoad } from "../../lib/hooks";

function Item({ to, icon: Icon, children, badge }: { to: string; icon: typeof Server; children: React.ReactNode; badge?: number }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        clsx("flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition", isActive ? "bg-accent/15 text-fg" : "text-muted hover:bg-white/5 hover:text-fg")
      }
    >
      <Icon size={15} />
      <span className="flex-1">{children}</span>
      {!!badge && <span className="rounded-full bg-down/20 px-1.5 text-[10px] font-semibold text-down tabular-nums">{badge}</span>}
    </NavLink>
  );
}

function Group({ label }: { label: string }) {
  return <div className="px-2 pt-4 pb-1 text-[10px] font-semibold tracking-widest text-faint uppercase">{label}</div>;
}

export default function AdminShell() {
  const { data: services } = useLoad(() => api.get<Service[]>("/api/services"), [], (e) => e.type === "status" || e.type === "layout");
  const [auth, setAuth] = useState<{ enabled: boolean; version: string } | null>(null);
  useEffect(() => {
    api.get<{ enabled: boolean; version: string }>("/api/auth/status").then(setAuth).catch(() => {});
  }, []);
  const failing = services?.filter((s) => statusInfo(s.type, s.status).dot === "down").length ?? 0;

  const logout = async () => {
    await api.post("/api/auth/logout");
    location.href = "/login";
  };

  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-panel">
        <NavLink to="/" className="flex items-center gap-2.5 px-4 py-4">
          <Logo />
          <span className="font-semibold tracking-tight">ServiceHub</span>
        </NavLink>
        <nav className="grid gap-0.5 px-3">
          <Group label="Manage" />
          <Item to="/admin/services" icon={Server} badge={failing}>Services</Item>
          <Item to="/admin/launcher" icon={LayoutGrid}>Launcher layout</Item>
          <Group label="Activity" />
          <Item to="/admin/runs" icon={History}>Run history</Item>
          <Group label="System" />
          <Item to="/admin/settings" icon={Settings}>Settings</Item>
        </nav>
        <div className="mt-auto grid gap-1 border-t border-line p-3">
          <NavLink to="/" className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted transition hover:bg-white/5 hover:text-fg">
            <Rocket size={15} /> Launcher
          </NavLink>
          <div className="flex items-center justify-between px-2.5 pt-1 text-xs text-faint">
            <span className="font-mono">{auth?.version ?? ""}</span>
            {auth?.enabled && (
              <button className="btn-ghost p-1.5" title="Sign out" onClick={logout}><LogOut size={14} /></button>
            )}
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto bg-bg">
        {auth && !auth.enabled && (
          <div className="flex items-center gap-2 border-b border-warn/30 bg-warn/5 px-6 py-2 text-xs text-warn">
            <AlertTriangle size={13} />
            No password is set, so anyone who can reach ServiceHub can use it. Set <span className="font-mono">SERVICEHUB_PASSWORD</span> in your compose file.
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
