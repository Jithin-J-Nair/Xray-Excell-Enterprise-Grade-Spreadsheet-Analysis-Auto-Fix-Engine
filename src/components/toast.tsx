"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, X } from "lucide-react";

export interface Toast {
  id: number;
  kind: "ok" | "error";
  message: string;
}

let seq = 1;
const listeners = new Set<(t: Toast) => void>();

/** Imperative toast pusher usable from any client module. */
export function toast(message: string, kind: Toast["kind"] = "ok") {
  const t: Toast = { id: seq++, kind, message };
  listeners.forEach((fn) => fn(t));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const fn = (t: Toast) => {
      setItems((prev) => [...prev.slice(-3), t]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 5200);
    };
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-2xl backdrop-blur-md max-w-sm animate-[toastIn_.25s_ease] ${
            t.kind === "ok" ? "border-ok/40 bg-[#062015]/90 text-ok" : "border-hot/40 bg-[#22060f]/90 text-hot"
          }`}
          role="status"
        >
          {t.kind === "ok" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />}
          <span className="mono text-xs leading-relaxed break-all">{t.message}</span>
          <button
            onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
            className="opacity-60 hover:opacity-100 shrink-0"
            aria-label="Dismiss"
          >
            <X size={13} />
          </button>
        </div>
      ))}
      <style jsx global>{`
        @keyframes toastIn {
          from {
            transform: translateY(10px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
