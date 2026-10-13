"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ZoomIn, ZoomOut, Maximize2, CircleDot, Link2, X } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { Panel, PanelTitle } from "@/components/ui";
import type { AnalysisDetail } from "./shared";
import type { GraphEdge, GraphNode, Severity } from "@/lib/excel/types";
import {
  DEFAULT_FILTER,
  GRAPH_NODE_CAP,
  buildRiskIndex,
  filterGraph,
  layoutGraph,
  type GraphFilter,
} from "@/lib/excel/graph-layout";

function edgeColor(e: GraphEdge): string {
  if (e.cycle) return "#f472b6";
  if (e.kind === "missing") return "#fb7185";
  if (e.kind === "external") return "#a78bfa";
  if (e.kind === "cross-file") return "#fbbf24";
  if (e.kind === "cross") return "#38bdf8";
  return "#35507c";
}
function nodeColor(n: GraphNode): string {
  if (n.cycle) return "#f472b6";
  if (n.external) return "#a78bfa";
  if (n.missing) return "#fb7185";
  if (n.formula) return "#22d3ee";
  return "#7d90ad";
}
const SEV_COLOR: Record<Severity, string> = { critical: "#f472b6", error: "#fb7185", warning: "#fbbf24", info: "#38bdf8" };

interface Tx {
  x: number;
  y: number;
  k: number;
}

export function GraphTab({ detail }: { detail: AnalysisDetail }) {
  const { t } = useI18n();
  const res = detail.result!;
  const graph = res.graph;
  const multi = res.files.length > 1;

  const [filter, setFilter] = useState<GraphFilter>(DEFAULT_FILTER);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [tx, setTx] = useState<Tx>({ x: 24, y: 24, k: 1 });
  const [autoFitKey, setAutoFitKey] = useState(0);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const miniDragRef = useRef<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ w: 900, h: 560 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setViewport({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const riskIdx = useMemo(() => buildRiskIndex(res.risks, multi), [res.risks, multi]);

  const sheets = useMemo(() => {
    const s = new Set<string>();
    for (const n of graph.nodes) if (!n.external && !n.missing) s.add(n.sheet);
    return [...s].sort();
  }, [graph.nodes]);

  const filtered = useMemo(
    () => filterGraph(graph, filter, riskIdx, GRAPH_NODE_CAP),
    [graph, filter, riskIdx]
  );

  const laid = useMemo(() => layoutGraph(filtered.nodes, filtered.edges), [filtered]);

  const fitView = useCallback(
    (w: number, h: number) => {
      if (!w || !h) return;
      const k = Math.min(viewport.w / (w + 60), viewport.h / (h + 60), 1.6);
      setTx({
        k,
        x: (viewport.w - w * k) / 2,
        y: (viewport.h - h * k) / 2,
      });
    },
    [viewport]
  );

  // Fit to view whenever layout, filters, or viewport dimensions change.
  useEffect(() => {
    // Recenter the SVG viewport after graph layout/filter changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fitView(laid.width, laid.height);
  }, [fitView, laid, autoFitKey]);

  const nodeById = useMemo(() => new Map(filtered.nodes.map((n) => [n.id, n])), [filtered.nodes]);

  const formulas = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of res.formulas) {
      const id = multi ? `${f.file}::${f.sheet}!${f.cell}` : `${f.sheet}!${f.cell}`;
      map.set(id, `=${f.f}`);
    }
    return map;
  }, [res.formulas, multi]);

  const focus = focusId ? (nodeById.get(focusId) ?? null) : null;
  const neighbors = useMemo(() => {
    if (!focus) return new Set<string>();
    const s = new Set([focus.id]);
    for (const e of filtered.edges) {
      if (e.from === focus.id) s.add(e.to);
      if (e.to === focus.id) s.add(e.from);
    }
    return s;
  }, [focus, filtered.edges]);

  // zoom around cursor
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setTx((p) => {
        const k = Math.min(3, Math.max(0.12, p.k * (e.deltaY > 0 ? 0.9 : 1.1)));
        const s = k / p.k;
        return { k, x: mx - (mx - p.x) * s, y: my - (my - p.y) * s };
      });
    },
    []
  );

  const zoomBtn = (dir: 1 | -1) => {
    setTx((p) => {
      const k = Math.min(3, Math.max(0.12, p.k * (dir > 0 ? 1.25 : 0.8)));
      const s = k / p.k;
      const mx = viewport.w / 2;
      const my = viewport.h / 2;
      return { k, x: mx - (mx - p.x) * s, y: my - (my - p.y) * s };
    });
  };

  // minimap geometry
  const miniW = 168;
  const miniScale = laid.width > 0 ? Math.min(miniW / laid.width, 100 / Math.max(laid.height, 1)) : 1;
  const miniH = Math.max(54, laid.height * miniScale);
  const vpRect = {
    x: (-tx.x / tx.k) * miniScale,
    y: (-tx.y / tx.k) * miniScale,
    w: (viewport.w / tx.k) * miniScale,
    h: (viewport.h / tx.k) * miniScale,
  };
  const miniToWorld = useCallback(
    (mx: number, my: number) => {
      // center the viewport on the clicked minimap point
      const wx = mx / miniScale;
      const wy = my / miniScale;
      setTx((p) => ({ ...p, x: viewport.w / 2 - wx * p.k, y: viewport.h / 2 - wy * p.k }));
    },
    [miniScale, viewport]
  );

  if (!graph.nodes.length) {
    return (
      <Panel className="p-16 text-center text-dim text-sm">
        <div className="text-4xl mb-3 mono text-accent/40">∅</div>
        {t("graph.empty")}
      </Panel>
    );
  }

  const cur = filter;
  const setF = (patch: Partial<GraphFilter>) => {
    setFilter((p) => ({ ...p, ...patch }));
    setAutoFitKey((k) => k + 1);
  };

  return (
    <div className="grid lg:grid-cols-4 gap-4">
      <Panel className="lg:col-span-3 overflow-hidden" glow>
        <PanelTitle
          right={
            <div className="flex items-center gap-2">
              <button onClick={() => zoomBtn(-1)} className="btn btn-ghost !p-1.5" aria-label="Zoom out">
                <ZoomOut size={13} />
              </button>
              <button onClick={() => zoomBtn(1)} className="btn btn-ghost !p-1.5" aria-label="Zoom in">
                <ZoomIn size={13} />
              </button>
              <button onClick={() => setAutoFitKey((k) => k + 1)} className="btn btn-ghost !p-1.5" aria-label="Fit view">
                <Maximize2 size={13} />
              </button>
            </div>
          }
        >
          {t("an.tabs.graph")}
          <span className="ml-2 normal-case tracking-normal text-accent/80">
            {filtered.nodes.length}n / {filtered.edges.length}e
          </span>
          {(filtered.capped || graph.truncated) && <span className="ml-2 text-warn normal-case">cap {GRAPH_NODE_CAP}</span>}
        </PanelTitle>

        {/* filter toolbar */}
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3 border-b border-edge/60">
          <select value={cur.sheet} onChange={(e) => setF({ sheet: e.target.value as GraphFilter["sheet"] })} className="!py-1 !px-2 text-[11px] max-w-[180px]">
            <option value="all">{t("an.col.sheet")} — all</option>
            {sheets.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={cur.severity} onChange={(e) => setF({ severity: e.target.value as GraphFilter["severity"] })} className="!py-1 !px-2 text-[11px]">
            <option value="all">{t("risks.filter.all")}</option>
            {(["critical", "error", "warning", "info"] as const).map((s) => (
              <option key={s} value={s}>
                {t(`an.sev.${s}`)}
              </option>
            ))}
          </select>
          <select value={cur.type} onChange={(e) => setF({ type: e.target.value as GraphFilter["type"] })} className="!py-1 !px-2 text-[11px]">
            <option value="all">type — all</option>
            <option value="circular">circular</option>
            <option value="external">external</option>
            <option value="volatile">volatile</option>
            <option value="hardcoded">hardcoded</option>
          </select>
          <button
            onClick={() => setF({ onlyCircular: !cur.onlyCircular, onlyExternal: false })}
            className={`btn text-[10.5px] !py-1 !px-2.5 ${cur.onlyCircular ? "btn-primary" : "btn-ghost"}`}
          >
            <CircleDot size={11} />
            circular only
          </button>
          <button
            onClick={() => setF({ onlyExternal: !cur.onlyExternal, onlyCircular: false })}
            className={`btn text-[10.5px] !py-1 !px-2.5 ${cur.onlyExternal ? "btn-primary" : "btn-ghost"}`}
          >
            <Link2 size={11} />
            external only
          </button>
          {focus && (
            <button onClick={() => setFocusId(null)} className="btn btn-danger text-[10.5px] !py-1 !px-2.5 ml-auto">
              <X size={11} />
              exit focus
            </button>
          )}
        </div>

        {/* main canvas */}
        <div
          ref={containerRef}
          className="h-[560px] overflow-hidden cursor-grab active:cursor-grabbing select-none relative"
          onWheel={onWheel}
          onPointerDown={(e) => {
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
            dragRef.current = { x: e.clientX - tx.x, y: e.clientY - tx.y };
            setIsDragging(true);
          }}
          onPointerMove={(e) => {
            if (!dragRef.current) return;
            setTx((p) => ({ ...p, x: e.clientX - dragRef.current!.x, y: e.clientY - dragRef.current!.y }));
          }}
          onPointerUp={() => {
            dragRef.current = null;
            setIsDragging(false);
          }}
          onPointerLeave={() => {
            dragRef.current = null;
            setIsDragging(false);
          }}
        >
          <svg width="100%" height="100%">
            <g transform={`translate(${tx.x},${tx.y}) scale(${tx.k})`} style={{ transition: isDragging ? undefined : "transform .12s ease-out" }}>
              {/* sheet clusters */}
              {laid.clusters.map((c) => (
                <g key={c.id}>
                  <rect
                    x={c.x - 10}
                    y={c.y - 34}
                    width={c.w + 20}
                    height={c.h + 48}
                    rx={12}
                    fill="rgba(56,189,248,0.028)"
                    stroke="rgba(56,129,196,0.22)"
                    strokeDasharray="3 5"
                  />
                  <text x={c.x} y={c.y - 14} fontSize="10.5" fill="#5f7ca3" style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.12em" }}>
                    {c.label.toUpperCase()} · {c.count}
                  </text>
                </g>
              ))}
              {/* edges */}
              {laid.edges.map((le, i) => {
                const color = edgeColor(le.edge);
                const hot = focus && (le.edge.from === focus.id || le.edge.to === focus.id);
                const d = le.points.map((p, j) => `${j === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
                return (
                  <path
                    key={i}
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth={hot ? 2.4 / tx.k + 1.2 : le.edge.cycle ? 1.8 : 1.1}
                    strokeDasharray={le.edge.kind === "missing" ? "5 4" : le.edge.kind === "external" ? "2 4" : undefined}
                    opacity={focus ? (hot ? 1 : 0.07) : le.edge.cycle ? 0.95 : 0.5}
                    markerEnd={`url(#arr-${color.slice(1)})`}
                  />
                );
              })}
              <defs>
                {["f472b6", "fb7185", "a78bfa", "fbbf24", "38bdf8", "35507c"].map((c) => (
                  <marker key={c} id={`arr-${c}`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                    <path d="M0,0 L7,3.5 L0,7 z" fill={`#${c}`} />
                  </marker>
                ))}
              </defs>
              {/* nodes */}
              {laid.nodes.map((ln) => {
                const n = ln.node;
                const color = nodeColor(n);
                const isFocus = focus?.id === n.id;
                const dimmed = focus && !neighbors.has(n.id);
                const rk = riskIdx.get(n.id);
                return (
                  <g
                    key={n.id}
                    transform={`translate(${ln.x}, ${ln.y})`}
                    onClick={() => setFocusId(isFocus ? null : n.id)}
                    className="cursor-pointer"
                    opacity={dimmed ? 0.14 : 1}
                  >
                    <rect
                      width={ln.w}
                      height={ln.h}
                      rx={7}
                      fill={isFocus ? `${color}26` : "rgba(9,15,27,0.94)"}
                      stroke={color}
                      strokeWidth={isFocus ? 2.2 : rk ? 1.6 : 1}
                      style={n.cycle ? { filter: "drop-shadow(0 0 7px #f472b677)" } : undefined}
                    />
                    <text x={9} y={ln.h / 2 + 3.5} fontSize="10.5" fill={color} style={{ fontFamily: "var(--font-mono)" }}>
                      {(n.id.split("::").pop() ?? n.id).slice(0, 26)}
                    </text>
                    {rk && <circle cx={ln.w - 9} cy={ln.h / 2} r={3.2} fill={SEV_COLOR[rk.worst]} />}
                  </g>
                );
              })}
            </g>
          </svg>

          {/* minimap */}
          <div
            className="absolute bottom-3 right-3 rounded-lg border border-edge2/80 bg-void/85 backdrop-blur-sm p-1.5 cursor-crosshair"
            onPointerDown={(e) => {
              e.stopPropagation();
              miniDragRef.current = true;
              (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              miniToWorld(e.clientX - r.left - 6, e.clientY - r.top - 6);
            }}
            onPointerMove={(e) => {
              if (!miniDragRef.current) return;
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              miniToWorld(e.clientX - r.left - 6, e.clientY - r.top - 6);
            }}
            onPointerUp={() => (miniDragRef.current = false)}
          >
            <svg width={miniW} height={miniH}>
              {laid.clusters.map((c) => (
                <rect key={c.id} x={c.x * miniScale} y={c.y * miniScale} width={Math.max(6, c.w * miniScale)} height={Math.max(6, c.h * miniScale)} fill="rgba(56,189,248,0.08)" rx={2} />
              ))}
              {laid.nodes.map((ln) => (
                <rect key={ln.id} x={ln.x * miniScale} y={ln.y * miniScale} width={Math.max(1.6, ln.w * miniScale)} height={Math.max(1.2, ln.h * miniScale)} fill={nodeColor(ln.node)} opacity={0.75} />
              ))}
              <rect x={vpRect.x} y={vpRect.y} width={Math.max(8, vpRect.w)} height={Math.max(8, vpRect.h)} fill="rgba(34,211,238,0.1)" stroke="#22d3ee" strokeWidth={1} rx={2} />
            </svg>
          </div>
        </div>

        {/* legend */}
        <div className="flex flex-wrap gap-4 px-4 py-2.5 border-t border-edge/60 text-[10px] mono text-dim">
          {[
            ["#22d3ee", t("graph.legend.formula")],
            ["#7d90ad", t("graph.legend.value")],
            ["#a78bfa", t("graph.legend.external")],
            ["#fb7185", t("graph.legend.missing")],
            ["#f472b6", t("graph.legend.cycle")],
          ].map(([c, label]) => (
            <span key={label as string} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: c as string }} />
              {label}
            </span>
          ))}
          <span className="ml-auto">{t("graph.zoom")}</span>
        </div>
      </Panel>

      {/* side details */}
      <Panel className="p-4 h-fit lg:sticky lg:top-20">
        <PanelTitle>{focus ? focus.id.split("::").pop() : "…"}</PanelTitle>
        {focus ? (
          <div className="px-4 pb-4 space-y-3 text-xs">
            <div>
              <div className="text-dim mb-1">{t("graph.node.kind")}</div>
              <div className="mono" style={{ color: nodeColor(focus) }}>
                {focus.cycle ? "circular member" : focus.external ? "external workbook" : focus.missing ? "missing target" : focus.formula ? "formula cell" : "referenced cell"}
              </div>
            </div>
            {riskIdx.get(focus.id) && (
              <div>
                <div className="text-dim mb-1">risk</div>
                <div className="mono" style={{ color: SEV_COLOR[riskIdx.get(focus.id)!.worst] }}>
                  {riskIdx.get(focus.id)!.worst} · {[...riskIdx.get(focus.id)!.types].join(", ")}
                </div>
              </div>
            )}
            {formulas.get(focus.id) && (
              <div>
                <div className="text-dim mb-1">{t("graph.node.formula")}</div>
                <pre className="mono text-[10.5px] leading-relaxed bg-ink/80 border border-edge/60 rounded-lg p-2.5 whitespace-pre-wrap break-all text-accent">
                  {formulas.get(focus.id)}
                </pre>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-edge/60 bg-ink/60 p-2.5">
                <div className="text-dim text-[10px] mb-1">depends on</div>
                <div className="mono text-lg font-bold text-accent">{filtered.edges.filter((e) => e.from === focus.id).length}</div>
              </div>
              <div className="rounded-lg border border-edge/60 bg-ink/60 p-2.5">
                <div className="text-dim text-[10px] mb-1">used by</div>
                <div className="mono text-lg font-bold text-warn">{filtered.edges.filter((e) => e.to === focus.id).length}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="px-4 pb-4 text-xs text-dim leading-relaxed">
            {t("graph.zoom")}
            <div className="mt-3 space-y-1 mono text-[10px]">
              <div>· filter by sheet / severity / type</div>
              <div>· toggle circular / external views</div>
              <div>· click a node for focus mode</div>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
