import { Loader2, LockKeyhole } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Backdrop } from "../components/Backdrop";
import { Logo } from "../components/ui";
import { api } from "../lib/api";

export default function Login() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [params] = useSearchParams();
  const nav = useNavigate();
  const next = params.get("next") || "/";

  const go = () => {
    // /s/ paths are served by the backend, not the SPA
    if (next.startsWith("/s/")) location.href = next;
    else nav(next, { replace: true });
  };

  useEffect(() => {
    api.get<{ authed: boolean }>("/api/auth/status").then((s) => s.authed && go()).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api.post("/api/auth/login", { password: pw });
      go();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-full place-items-center p-4">
      <Backdrop />
      <form onSubmit={submit} className="glass pop-in grid w-full max-w-sm gap-5 rounded-2xl p-8">
        <div className="flex items-center gap-3">
          <Logo size={32} />
          <div>
            <div className="text-lg font-semibold tracking-tight text-white/95">ServiceHub</div>
            <div className="text-xs text-white/45">Enter the password to continue.</div>
          </div>
        </div>
        <div className="relative">
          <LockKeyhole size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-white/40" />
          <input
            autoFocus
            type="password"
            className="input border-white/10 bg-black/25 pl-9"
            placeholder="Password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
        </div>
        {err && <div className="-mt-2 text-sm text-down">{err}</div>}
        <button className="btn-primary" disabled={busy || !pw}>
          {busy ? <><Loader2 size={14} className="animate-spin" /> Signing in…</> : "Sign in"}
        </button>
      </form>
    </div>
  );
}
