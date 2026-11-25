import { useEffect, useState, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./lib/api";
import Launcher from "./pages/Launcher";
import Login from "./pages/Login";
import Unlock from "./pages/Unlock";
import AdminShell from "./pages/admin/AdminShell";
import Services from "./pages/admin/Services";
import ServiceDetail from "./pages/admin/ServiceDetail";
import LayoutPage from "./pages/admin/Layout";
import Runs from "./pages/admin/Runs";
import SettingsPage from "./pages/admin/Settings";
import { Spinner } from "./components/ui";

type AuthStatus = { enabled: boolean; authed: boolean; version: string };

function RequireAuth({ children }: { children: ReactNode }) {
  const [st, setSt] = useState<AuthStatus | null>(null);
  const loc = useLocation();
  useEffect(() => {
    api.get<AuthStatus>("/api/auth/status").then(setSt).catch(() => setSt({ enabled: true, authed: false, version: "" }));
  }, []);
  if (!st) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  }
  if (!st.authed) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/unlock/:slug" element={<Unlock />} />
      <Route path="/" element={<Launcher />} />
      <Route path="/admin" element={<RequireAuth><AdminShell /></RequireAuth>}>
        <Route index element={<Navigate to="/admin/services" replace />} />
        <Route path="services" element={<Services />} />
        <Route path="services/:slug" element={<ServiceDetail />} />
        <Route path="services/:slug/:tab" element={<ServiceDetail />} />
        <Route path="launcher" element={<LayoutPage />} />
        <Route path="runs" element={<Runs />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
