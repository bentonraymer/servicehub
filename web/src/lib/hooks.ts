import { useCallback, useEffect, useRef, useState } from "react";

type Listener = (e: { type: string; slug?: string; run_id?: number; status?: string }) => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;

function ensureSource() {
  if (source) return;
  source = new EventSource("/api/events");
  source.onmessage = (m) => {
    try {
      const e = JSON.parse(m.data);
      listeners.forEach((l) => l(e));
    } catch {
      /* ignore */
    }
  };
  source.onerror = () => {
    // EventSource retries on its own; tell listeners to refresh when it comes back
    source?.addEventListener("open", () => listeners.forEach((l) => l({ type: "reconnect" })), { once: true });
  };
}

/** Subscribe to the server's live event stream. */
export function useEvents(fn: Listener) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    ensureSource();
    const l: Listener = (e) => ref.current(e);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
}

/** Load data, with reload() and a debounced refresh on server events. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = [], refreshOn?: (e: { type: string; slug?: string }) => boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const timer = useRef<number | undefined>(undefined);

  const reload = useCallback(async () => {
    try {
      const d = await loaderRef.current();
      setData(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEvents((e) => {
    if (!refreshOn || e.type === "reconnect" || refreshOn(e)) {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(reload, 150);
    }
  });

  return { data, setData, error, loading, reload };
}

/** Re-render every `ms` so relative times stay fresh. */
export function useTick(ms = 15000) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => set((n) => n + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

export function useKey(key: string, fn: (e: KeyboardEvent) => void, enabled = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === key) ref.current(e);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [key, enabled]);
}
