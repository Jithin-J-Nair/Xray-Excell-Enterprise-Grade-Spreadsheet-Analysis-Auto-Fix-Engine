// ── Layered hierarchical graph layout (dagre) + filtering (isomorphic) ───────
import dagre from "dagre";
import type { DependencyGraph, GraphEdge, GraphNode, Risk, Severity, RiskType } from "./types";

export const GRAPH_NODE_CAP = 300;
export const NODE_W = 172;
export const NODE_H = 28;

export type GraphTypeFilter = "all" | "circular" | "external" | "volatile" | "hardcoded";

export interface GraphFilter {
  sheet: string | "all";
  severity: Severity | "all";
  type: GraphTypeFilter;
  onlyCircular: boolean;
  onlyExternal: boolean;
}

export const DEFAULT_FILTER: GraphFilter = {
  sheet: "all",
  severity: "all",
  type: "all",
  onlyCircular: false,
  onlyExternal: false,
};

const SEV_ORDER: Record<Severity, number> = { critical: 0, error: 1, warning: 2, info: 3 };

export interface NodeRisk {
  worst: Severity;
  types: Set<string>;
}
export type RiskIndex = Map<string, NodeRisk>;

/** Map analysis risks onto graph node ids (same id scheme as the analyzer). */
export function buildRiskIndex(risks: Risk[], multiFile: boolean): RiskIndex {
  const idx: RiskIndex = new Map();
  for (const r of risks) {
    if (!r.sheet || !r.cell) continue;
    const id = multiFile ? `${r.file}::${r.sheet}!${r.cell}` : `${r.sheet}!${r.cell}`;
    const cur = idx.get(id);
    if (!cur) {
      idx.set(id, { worst: r.severity, types: new Set([r.type as string]) });
    } else {
      cur.types.add(r.type as string);
      if (SEV_ORDER[r.severity] < SEV_ORDER[cur.worst]) cur.worst = r.severity;
    }
  }
  return idx;
}

const TYPE_TO_RISK: Record<Exclude<GraphTypeFilter, "all" | "circular" | "external">, RiskType> = {
  volatile: "VOLATILE_FUNCTION",
  hardcoded: "HARDCODED_NUMBER",
};

function nodeMatches(g: GraphNode, f: GraphFilter, idx: RiskIndex): boolean {
  if (f.sheet !== "all" && g.sheet !== f.sheet) return false;
  if (f.onlyCircular && !g.cycle) return false;
  if (f.onlyExternal && !g.external) return false;
  if (f.severity !== "all") {
    const rk = idx.get(g.id);
    if (!rk || rk.worst !== f.severity) return false;
  }
  if (f.type !== "all") {
    if (f.type === "circular" && !g.cycle) return false;
    if (f.type === "external" && !g.external) return false;
    if (f.type === "volatile" || f.type === "hardcoded") {
      const rk = idx.get(g.id);
      if (!rk || !rk.types.has(TYPE_TO_RISK[f.type])) return false;
    }
  }
  return true;
}

export interface FilteredGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  capped: boolean;
  primaryIds: Set<string>;
}

/**
 * Apply filters, widen to 1-hop neighbours (so the result is not a cloud of
 * dots), then cap to `cap` nodes prioritising circular/risky/formula nodes.
 */
export function filterGraph(graph: DependencyGraph, f: GraphFilter, idx: RiskIndex, cap = GRAPH_NODE_CAP): FilteredGraph {
  const off =
    f.sheet === "all" && f.severity === "all" && f.type === "all" && !f.onlyCircular && !f.onlyExternal;
  if (off) {
    // No filtering — just cap deterministically
    const pri = priority(graph.nodes, idx);
    const keep = new Set(pri.slice(0, cap).map((n) => n.id));
    return {
      nodes: pri.slice(0, cap),
      edges: graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
      capped: graph.nodes.length > cap,
      primaryIds: keep,
    };
  }
  const primary = graph.nodes.filter((n) => nodeMatches(n, f, idx));
  const primaryIds = new Set(primary.map((n) => n.id));
  // 1-hop widening
  const expanded = new Set(primaryIds);
  for (const e of graph.edges) {
    if (primaryIds.has(e.from) || primaryIds.has(e.to)) {
      expanded.add(e.from);
      expanded.add(e.to);
    }
  }
  let nodes = graph.nodes.filter((n) => expanded.has(n.id));
  // sort: primary first (they carry the signal), then priority
  const pri = priority(nodes, idx);
  nodes = pri.sort((a, b) => Number(primaryIds.has(b.id)) - Number(primaryIds.has(a.id)));
  const capped = nodes.length > cap;
  nodes = nodes.slice(0, cap);
  const keep = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  return { nodes, edges, capped, primaryIds };
}

function priority(nodes: GraphNode[], idx: RiskIndex): GraphNode[] {
  const score = (n: GraphNode) => {
    let s = 0;
    if (n.cycle) s += 1000;
    const rk = idx.get(n.id);
    if (rk) s += 500 - SEV_ORDER[rk.worst] * 100;
    if (n.formula) s += 50;
    if (n.external || n.missing) s += 80;
    return s;
  };
  return [...nodes].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
}

// ── layout ───────────────────────────────────────────────────────────────────

export interface LaidNode {
  id: string;
  node: GraphNode;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface LaidEdge {
  edge: GraphEdge;
  points: { x: number; y: number }[];
}
export interface LaidCluster {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  count: number;
}
export interface LaidGraph {
  nodes: LaidNode[];
  edges: LaidEdge[];
  clusters: LaidCluster[];
  width: number;
  height: number;
}

/** Layered left-to-right hierarchical layout with per-sheet cluster boxes. */
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]): LaidGraph {
  const g = new dagre.graphlib.Graph({ compound: true, multigraph: false, directed: true });
  g.setGraph({
    rankdir: "LR",
    nodesep: 14,
    ranksep: 92,
    edgesep: 12,
    marginx: 24,
    marginy: 24,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // per-sheet clusters
  const CLUSTER_PADDING = 14;
  const sheetCount = new Map<string, number>();
  for (const n of nodes) {
    const sheet = n.external || n.missing ? `(${n.external ? "external" : "missing"})` : n.sheet;
    sheetCount.set(sheet, (sheetCount.get(sheet) ?? 0) + 1);
  }
  const clusterOf = new Map<string, string>();
  for (const sheet of sheetCount.keys()) {
    const cid = `CLUSTER::${sheet}`;
    clusterOf.set(sheet, cid);
    g.setNode(cid, { label: sheet } as Record<string, unknown>);
  }
  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_W, height: NODE_H });
    const sheet = n.external || n.missing ? `(${n.external ? "external" : "missing"})` : n.sheet;
    const cid = clusterOf.get(sheet);
    if (cid) g.setParent(n.id, cid);
  }
  const seen = new Set<string>();
  for (const e of edges) {
    const key = `${e.from}->${e.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!nodes.find((n) => n.id === e.from) || !nodes.find((n) => n.id === e.to)) continue;
    g.setEdge(e.from, e.to);
  }

  dagre.layout(g);

  const laidNodes: LaidNode[] = [];
  for (const n of nodes) {
    const gn = g.node(n.id);
    if (!gn) continue;
    laidNodes.push({ id: n.id, node: n, x: gn.x - NODE_W / 2, y: gn.y - NODE_H / 2, w: NODE_W, h: NODE_H });
  }
  const laidEdges: LaidEdge[] = [];
  const edgeMap = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    const arr = edgeMap.get(`${e.from}->${e.to}`) ?? [];
    arr.push(e);
    edgeMap.set(`${e.from}->${e.to}`, arr);
  }
  for (const [key, group] of edgeMap) {
    const [from, to] = key.split("->");
    const ge = g.edge(from, to);
    if (!ge || !ge.points?.length) continue;
    for (const e of group.slice(0, 1)) {
      laidEdges.push({ edge: e, points: ge.points.map((p) => ({ x: p.x, y: p.y })) });
    }
  }
  const clusters: LaidCluster[] = [];
  for (const [sheet, cid] of clusterOf) {
    const gc = g.node(cid);
    if (!gc || !gc.width) continue;
    clusters.push({
      id: cid,
      label: sheet,
      x: gc.x - gc.width / 2 - CLUSTER_PADDING * 0,
      y: gc.y - gc.height / 2,
      w: gc.width,
      h: gc.height,
      count: sheetCount.get(sheet) ?? 0,
    });
  }
  const graphInfo = g.graph();
  return { nodes: laidNodes, edges: laidEdges, clusters, width: graphInfo.width ?? 800, height: graphInfo.height ?? 500 };
}
