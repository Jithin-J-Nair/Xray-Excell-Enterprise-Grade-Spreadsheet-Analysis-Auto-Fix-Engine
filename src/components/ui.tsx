"use client";
import type { ReactNode } from "react";
import type { Severity } from "@/lib/excel/types";

export const SEV_STYLE: Record<Severity, { color: string; bg: string; border: string; label: string }> = {
  critical: { color: "#f472b6", bg: "rgba(244,114,182,0.1)", border: "rgba(244,114,182,0.4)", label: "critical" },
  error: { color: "#fb7185", bg: "rgba(251,113,133,0.1)", border: "rgba(251,113,133,0.35)", label: "error" },
  warning: { color: "#fbbf24", bg: "rgba(251,191,36,0.08)", border: "rgba(251,191,36,0.35)", label: "warning" },
  info: { color: "#38bdf8", bg: "rgba(56,189,248,0.08)", border: "rgba(56,189,248,0.3)", label: "info" },
};

export function SevBadge({ sev, label }: { sev: Severity; label?: string }) {
  const s = SEV_STYLE[sev];
  return (
    <span className="chip" style={{ color: s.color, background: s.bg, borderColor: s.border }}>
      {label ?? s.label}
    </span>
  );
}

export function Panel({ children, className = "", glow = false }: { children: ReactNode; className?: string; glow?: boolean }) {
  return <div className={`panel ${glow ? "panel-glow" : ""} ${className}`}>{children}</div>;
}

export function PanelTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2.5">
      <h3 className="text-[11px] font-semibold tracking-[0.14em] uppercase text-dim">{children}</h3>
      {right}
    </div>
  );
}

export function fmtBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US");
}

export function relTime(iso: string | Date, lang: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return lang === "jp" ? "たった今" : "just now";
  if (mins < 60) return lang === "jp" ? `${mins}分前` : `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return lang === "jp" ? `${h}時間前` : `${h}h ago`;
  const days = Math.round(h / 24);
  return lang === "jp" ? `${days}日前` : `${days}d ago`;
}

export function StatusChip({ status, t }: { status: string; t: (k: string) => string }) {
  const map: Record<string, { color: string; border: string; bg: string }> = {
    completed: { color: "#34d399", border: "rgba(52,211,153,0.4)", bg: "rgba(52,211,153,0.08)" },
    processing: { color: "#38bdf8", border: "rgba(56,189,248,0.4)", bg: "rgba(56,189,248,0.08)" },
    running: { color: "#38bdf8", border: "rgba(56,189,248,0.4)", bg: "rgba(56,189,248,0.08)" },
    queued: { color: "#94a3b8", border: "rgba(148,163,184,0.4)", bg: "rgba(148,163,184,0.08)" },
    failed: { color: "#fb7185", border: "rgba(251,113,133,0.4)", bg: "rgba(251,113,133,0.08)" },
  };
  const s = map[status] ?? map.queued;
  return (
    <span className="chip" style={{ color: s.color, background: s.bg, borderColor: s.border }}>
      {(status === "processing" || status === "running") && <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: s.color }} />}
      {t(`status.${status}`)}
    </span>
  );
}

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${checked ? "bg-accent/80" : "bg-edge2"} disabled:opacity-40`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${checked ? "left-[18px]" : "left-0.5"}`}
      />
    </button>
  );
}

export function ProgressBar({ value, color = "#22d3ee" }: { value: number; color?: string }) {
  return (
    <div className="h-1.5 rounded-full bg-edge/70 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: `linear-gradient(90deg, ${color}88, ${color})` }}
      />
    </div>
  );
}
