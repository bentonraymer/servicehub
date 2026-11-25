import { Loader2, LockKeyhole } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Backdrop } from "../components/Backdrop";
import { ServiceIcon, Spinner } from "../components/ui";
import { api, enc } from "../lib/api";

type Info = { name: string; icon: string; type: string; locked: boolean };

/** Password gate for a single service. /s/<slug>/ redirects here when the service has its own password. */
export default function Unlock() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const [info, setInfo] = useState<Info | null>(null);
  const [missing, setMissing] = useState(false);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const next = (() => {
    const n = params.get("next") || "";
    // Only ever go back to this service (or the launcher), never somewhere a link chose.
    return n.startsWith(`/s/${slug}/`) ? n : null;
  })();
  const go = (t: string) => (location.href = next ?? (t === "static" || t === "webapp" ? `/s/${slug}/` : `/?open=${enc(slug)}`));

  useEffect(() => {
    api.get<Info>(`/api/services/${enc(slug)}/unlock`)
      .then((i) => (i.locked ? setInfo(i) : go(i.type)))
      .catch(() => setMissing(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api.post(`/api/services/${enc(slug)}/unlock`, { password: pw });
      go(info!.type);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-full place-items-center p-4">
      <Backdrop />
      {missing ? (
        <div className="glass pop-in grid w-full max-w-sm justify-items-center gap-3 rounded-2xl p-8 text-center">
          <div className="text-lg font-semibold text-white/95">Not found</div>
          <p className="text-sm text-white/50">There's no service called <span className="font-mono">{slug}</span>.</p>
          <Link to="/" className="btn-outline border-white/15">Back to the launcher</Link>
        </div>
      ) : !info ? (
        <Spinner />
      ) : (
        <form onSubmit={submit} className="glass pop-in grid w-full max-w-sm gap-5 rounded-2xl p-8">
          <div className="flex items-center gap-3">
            <ServiceIcon name={info.name} icon={info.icon} className="size-10 text-lg" />
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold tracking-tight text-white/95">{info.name}</div>
              <div className="text-xs text-white/45">This service has its own password.</div>
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
            {busy ? <><Loader2 size={14} className="animate-spin" /> Unlocking…</> : "Unlock"}
          </button>
          <Link to="/" className="-mt-1 text-center text-xs text-white/45 hover:text-white/80">Back to the launcher</Link>
        </form>
      )}
    </div>
  );
}
