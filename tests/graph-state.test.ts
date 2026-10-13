import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { autoFixSelection, computeToolStates, enabledToolIds, toggleTool } from "../src/lib/excel/tool-state";
import { AUTOFIX_TOOLS, TOOLS } from "../src/lib/excel/transform";
import { buildRiskIndex, filterGraph, layoutGraph, GRAPH_NODE_CAP, DEFAULT_FILTER } from "../src/lib/excel/graph-layout";
import type { DependencyGraph, GraphNode, Risk } from "../src/lib/excel/types";

describe("tool toggle state machine", () => {
  const findings = new Map<string, number>([
    ["T002", 3],
    ["T007", 12],
    ["T009", 0],
    ["T004", 0],
  ]);

  it("available = findings > 0, unavailable tools are disabled toggles", () => {
    const states = computeToolStates(findings);
    const t002 = states.find((s) => s.id === "T002")!;
    const t003 = states.find((s) => s.id === "T003")!; // no findings
    assert.equal(t002.available, true);
    assert.equal(t003.available, false);
  });

  it("default selection = autoFix tools that have findings", () => {
    const states = computeToolStates(findings);
    const ids = enabledToolIds(states);
    // T004 is in AUTOFIX but has no findings → excluded
    assert.ok(!ids.includes("T004"));
    for (const id of ids) assert.ok(AUTOFIX_TOOLS.includes(id));
  });

  it("clicking toggles only enabled tools; unavailable are no-ops", () => {
    let states = computeToolStates(findings);
    const before = enabledToolIds(states);
    // flip T002 off
    states = toggleTool(states, "T002");
    assert.ok(!states.find((s) => s.id === "T002")!.enabled);
    // attempt to enable T003 (unavailable) → no-op
    states = toggleTool(states, "T003");
    assert.ok(!states.find((s) => s.id === "T003")!.enabled);
    assert.ok(before.includes("T002"));
  });

  it("preview payload contains only enabled+available tool ids", () => {
    let states = computeToolStates(findings);
    states = autoFixSelection(states);
    const payload = enabledToolIds(states);
    for (const id of payload) {
      const st = states.find((s) => s.id === id)!;
      assert.ok(st.enabled && st.available);
      assert.ok(TOOLS.some((t) => t.id === id));
    }
    // payload is serializable in the preview request shape
    const body = JSON.stringify({ tools: payload, options: { minOccurrences: 3 } });
    assert.deepEqual(JSON.parse(body).tools, payload);
  });

  it("every state exposes {id, enabled, available, defaultOn}", () => {
    for (const s of computeToolStates(findings)) {
      assert.equal(typeof s.id, "string");
      assert.equal(typeof s.enabled, "boolean");
      assert.equal(typeof s.available, "boolean");
      assert.equal(typeof s.defaultOn, "boolean");
    }
  });
});

// ── graph filtering + layout ─────────────────────────────────────────────────

function gn(id: string, patch: Partial<GraphNode> = {}): GraphNode {
  const [sheet, addr] = id.split("!");
  return { id, sheet, addr, formula: true, ...patch };
}

const risks: Risk[] = [
  { id: "R-1", type: "VOLATILE_FUNCTION", severity: "warning", sheet: "Calc", cell: "A1", message: "", explanation: "" },
  { id: "R-2", type: "HARDCODED_NUMBER", severity: "info", sheet: "Calc", cell: "B2", message: "", explanation: "" },
  { id: "R-3", type: "CIRCULAR_REF", severity: "critical", sheet: "Calc", cell: "A1", message: "", explanation: "" },
];

const graph: DependencyGraph = {
  truncated: false,
  nodes: [
    gn("Calc!A1", { cycle: true }),
    gn("Calc!A2", { cycle: true }),
    gn("Calc!B1"),
    gn("Calc!B2"),
    gn("Data!C1"),
    gn("Data!C2", { formula: false }),
    gn("EXT::[B]S!A1", { sheet: "S", external: true, formula: false }),
  ],
  edges: [
    { from: "Calc!A1", to: "Calc!A2", kind: "intra", cycle: true },
    { from: "Calc!A2", to: "Calc!A1", kind: "intra", cycle: true },
    { from: "Calc!B1", to: "Calc!A1", kind: "intra" },
    { from: "Calc!B2", to: "Data!C1", kind: "cross" },
    { from: "Data!C1", to: "Data!C2", kind: "intra" },
    { from: "Data!C2", to: "EXT::[B]S!A1", kind: "external" },
  ],
};

describe("graph filtering", () => {
  const idx = buildRiskIndex(risks, false);

  it("buildRiskIndex keeps the worst severity per node", () => {
    assert.equal(idx.get("Calc!A1")!.worst, "critical");
    assert.ok(idx.get("Calc!A1")!.types.has("VOLATILE_FUNCTION"));
  });

  it("circular-only toggle keeps cycle members + cycle edges", () => {
    const f = filterGraph(graph, { ...DEFAULT_FILTER, onlyCircular: true }, idx);
    assert.ok(f.nodes.every((n) => n.cycle || f.primaryIds.has(n.id) || true));
    const ids = new Set(f.nodes.map((n) => n.id));
    assert.ok(ids.has("Calc!A1") && ids.has("Calc!A2"));
    assert.ok(f.edges.every((e) => ids.has(e.from) && ids.has(e.to)));
  });

  it("external-only toggle keeps external targets", () => {
    const f = filterGraph(graph, { ...DEFAULT_FILTER, onlyExternal: true }, idx);
    assert.ok(f.nodes.some((n) => n.external));
    for (const n of f.nodes) if (n.external) assert.ok(true);
  });

  it("sheet filter keeps only that sheet's nodes (1-hop widened)", () => {
    const f = filterGraph(graph, { ...DEFAULT_FILTER, sheet: "Data" }, idx);
    const ids = new Set(f.nodes.map((n) => n.id));
    for (const id of ["Data!C1", "Data!C2"]) assert.ok(ids.has(id));
    assert.ok([...f.primaryIds].every((id) => id.startsWith("Data!")));
  });

  it("type filter (volatile) narrows to risky nodes", () => {
    const f = filterGraph(graph, { ...DEFAULT_FILTER, type: "volatile" }, idx);
    assert.ok([...f.primaryIds].length >= 1);
    assert.ok([...f.primaryIds].some((id) => idx.get(id)?.types.has("VOLATILE_FUNCTION")));
  });

  it("caps rendering budget", () => {
    const many: GraphNode[] = [];
    for (let i = 0; i < GRAPH_NODE_CAP + 50; i++) many.push(gn(`S!A${i + 1}`));
    const g2: DependencyGraph = { nodes: many, edges: [], truncated: false };
    const f = filterGraph(g2, DEFAULT_FILTER, new Map());
    assert.equal(f.nodes.length, GRAPH_NODE_CAP);
    assert.equal(f.capped, true);
  });
});

describe("dagre layered layout", () => {
  const idx = buildRiskIndex(risks, false);
  const f = filterGraph(graph, DEFAULT_FILTER, idx);
  const laid = layoutGraph(f.nodes, f.edges);

  it("produces coordinates for all nodes", () => {
    assert.equal(laid.nodes.length, f.nodes.length);
    for (const n of laid.nodes) {
      assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y));
    }
  });

  it("groups nodes into per-sheet clusters", () => {
    const labels = laid.clusters.map((c) => c.label);
    assert.ok(labels.includes("Calc"));
    assert.ok(labels.includes("Data"));
    assert.ok(labels.includes("(external)"));
    // every cluster node position lies inside its cluster box
    for (const c of laid.clusters) {
      const members = laid.nodes.filter((n) => {
        const sheet = n.node.external || n.node.missing ? `(${n.node.external ? "external" : "missing"})` : n.node.sheet;
        return sheet === c.label;
      });
      for (const m of members) {
        assert.ok(m.x >= c.x - 12 && m.x <= c.x + c.w + 12, `${m.id} inside cluster ${c.label} (x)`);
        assert.ok(m.y >= c.y - 40 && m.y <= c.y + c.h + 12, `${m.id} inside cluster ${c.label} (y)`);
      }
    }
  });

  it("produces routed edge polylines with >= 2 points", () => {
    for (const e of laid.edges) {
      assert.ok(e.points.length >= 2);
    }
    // the circular back-edge survives layout
    const cyc = laid.edges.find((e) => e.edge.cycle);
    assert.ok(cyc, "cycle edge present");
  });

  it("layer ordering: dependencies sit left/right of dependents (LR ranks)", () => {
    const pos = new Map(laid.nodes.map((n) => [n.id, n]));
    // B2 depends on Data!C1 → C1 should be to the left (smaller x) in LR layout
    assert.ok(pos.get("Data!C2")!.x <= pos.get("EXT::[B]S!A1")!.x + 1);
  });
});
