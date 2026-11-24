import clsx from "clsx";
import { ArrowDownToLine, Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LogLine } from "../lib/api";

function hhmmss(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour12: false });
}

export function LogViewer({ url, className, onEnd, emptyText = "No output yet.", glass }: {
  url: string | null;
  className?: string;
  onEnd?: () => void;
  emptyText?: string;
  glass?: boolean;
}) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;

  useEffect(() => {
    setLines([]);
    if (!url) return;
    const es = new EventSource(url);
    es.addEventListener("history", (m) => setLines(JSON.parse((m as MessageEvent).data).lines));
    es.addEventListener("lines", (m) => {
      const add: LogLine[] = JSON.parse((m as MessageEvent).data).lines;
      setLines((prev) => {
        const next = prev.concat(add);
        return next.length > 3000 ? next.slice(next.length - 3000) : next;
      });
    });
    es.addEventListener("end", () => {
      es.close();
      endRef.current?.();
    });
    return () => es.close();
  }, [url]);

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines, follow]);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom !== follow) setFollow(atBottom);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(lines.map((l) => l.l).join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={clsx("relative min-h-0", className)}>
      <div
        ref={box}
        onScroll={onScroll}
        className={clsx(
          "h-full overflow-y-auto rounded-lg px-3 py-2 font-mono text-xs leading-relaxed",
          glass ? "border border-white/8 bg-black/30" : "border border-line bg-black/25",
        )}
      >
        {lines.length === 0 ? (
          <div className="py-6 text-center font-sans text-faint">{emptyText}</div>
        ) : (
          lines.map((l, i) => (
            <div key={i} className="log-line flex gap-3">
              <span className="shrink-0 select-none text-faint/70 tabular-nums">{hhmmss(l.t)}</span>
              <span className={clsx(l.s === "err" && "text-down/90", l.s === "sys" && "text-accent/80", l.s === "out" && "text-fg/90")}>
                {l.l || " "}
              </span>
            </div>
          ))
        )}
      </div>
      <div className="absolute top-1.5 right-3 flex gap-1">
        {lines.length > 0 && (
          <button className="btn-ghost bg-panel/80 p-1.5" title="Copy log" onClick={copy}>
            {copied ? <Check size={13} className="text-up" /> : <Copy size={13} />}
          </button>
        )}
      </div>
      {!follow && (
        <button
          className="btn-outline absolute right-3 bottom-3 bg-panel-2 py-1 text-xs shadow-xl"
          onClick={() => setFollow(true)}
        >
          <ArrowDownToLine size={13} /> Follow
        </button>
      )}
    </div>
  );
}
