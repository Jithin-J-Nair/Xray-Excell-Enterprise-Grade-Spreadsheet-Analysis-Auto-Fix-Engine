"use client";

/** Tiny dependency-free SVG charts — donut + horizontal bars. */

export function Donut({
  value,
  size = 150,
  stroke = 14,
  color = "#22d3ee",
  track = "#16233a",
  label,
  sub,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  label: string;
  sub?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.min(1, Math.max(0, value / 100));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${frac * c} ${c}`}
          style={{ transition: "stroke-dasharray 0.8s ease", filter: `drop-shadow(0 0 8px ${color}66)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="mono text-3xl font-bold" style={{ color }}>
          {label}
        </div>
        {sub && <div className="text-[10px] text-dim uppercase tracking-widest mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

export function HBars({
  items,
  max,
}: {
  items: { label: string; value: number; color: string }[];
  max?: number;
}) {
  const m = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-2.5">
      {items.map((it) => (
        <div key={it.label}>
          <div className="flex justify-between text-[11px] mb-1">
            <span className="text-dim">{it.label}</span>
            <span className="mono font-semibold" style={{ color: it.color }}>
              {it.value.toLocaleString()}
            </span>
          </div>
          <div className="h-2 rounded-full bg-edge/60 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(it.value / m) * 100}%`,
                background: `linear-gradient(90deg, ${it.color}55, ${it.color})`,
                transition: "width 0.7s ease",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
