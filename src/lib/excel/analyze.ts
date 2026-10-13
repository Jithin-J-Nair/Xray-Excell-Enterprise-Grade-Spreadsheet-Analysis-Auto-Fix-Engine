// ── Static analysis engine: risks, dependency graph, metrics (isomorphic) ────
import type {
  AnalysisMetrics,
  AnalysisResult,
  DependencyGraph,
  FormulaRecord,
  GraphEdge,
  GraphNode,
  Risk,
  RiskType,
  Severity,
  SheetModel,
  SheetSummary,
  WorkbookModel,
} from "./types";
import { VOLATILE_FUNCTIONS } from "./types";
import { abstractFormula, addrOf, parseFormula } from "./formula";

const CAP_RISK_PER_TYPE = 150;
const CAP_FORMULAS = 3000;
const CAP_GRAPH_NODES = 650;
const CAP_GRAPH_EDGES = 1600;
const RANGE_EXPAND_CAP = 40;

export interface FileMeta {
  id: string;
  name: string;
  size: number;
  encoding?: string;
}

export interface AnalyzeOptions {
  language?: "en" | "jp";
  resolveCrossFile?: boolean;
  name?: string;
}

function risk(
  type: RiskType,
  severity: Severity,
  message: string,
  explanation: string,
  extra: Partial<Risk> = {}
): Risk {
  return { id: "", type, severity, message, explanation, ...extra } as Risk;
}

const WS_DATE = /^\d{4}[/-]\d{1,2}[/-]\d{1,2}$|^\d{4}年\d{1,2}月\d{1,2}日([（(][日月火水木金土][)）])?$/;
const NUMERIC_TEXT = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;
const PLAIN_NUMERIC_TEXT = /^-?\d+(\.\d+)?$/;
const FULLWIDTH = /[！-｠　]/; // FF01-FF60 + U+3000
const MOJIBAKE = /�|Ã.|�/;

const NBSP = String.fromCharCode(0xa0);
const IDEO_SPACE = String.fromCharCode(0x3000);

function hasWsIssue(s: string): boolean {
  return s !== s.trim() || s.includes(NBSP) || s.includes(IDEO_SPACE);
}

export function analyzeAll(models: WorkbookModel[], metas: FileMeta[], opts: AnalyzeOptions = {}): AnalysisResult {
  const risks: Risk[] = [];
  const counts: Partial<Record<RiskType, number>> = {};
  const push = (r: Risk) => {
    counts[r.type] = (counts[r.type] ?? 0) + 1;
    const existing = risks.filter((x) => x.type === r.type).length;
    if (existing < CAP_RISK_PER_TYPE) risks.push(r);
  };

  const multi = models.length > 1;
  const fileOf = new Map<string, WorkbookModel>();
  const nodeFile = (m: WorkbookModel) => m.fileName;
  const nid = (m: WorkbookModel, sheet: string, addr: string) =>
    multi ? `${m.fileName}::${sheet}!${addr}` : `${sheet}!${addr}`;

  for (const m of models) fileOf.set(m.fileName, m);

  // ── per-cell pass ────────────────────────────────────────────────────────
  const formulas: FormulaRecord[] = [];
  let formulasTruncated = false;
  const volatileList: AnalysisResult["volatileList"] = [];
  const hardcodedList: AnalysisResult["hardcodedList"] = [];
  const referencedSheets = new Map<string, Set<string>>(); // fileName -> set of sheet names referenced
  const sheets: SheetSummary[] = [];
  let totalCells = 0;
  let totalFormulas = 0;
  let totalVolatile = 0;
  let totalHardcoded = 0;
  let totalMerged = 0;
  let errorCells = 0;
  const funcCount = new Map<string, number>();

  const edges: GraphEdge[] = [];
  const nodeMap = new Map<string, GraphNode>();
  const depMap = new Map<string, Set<string>>(); // for cycle detection

  const addNode = (id: string, n: Omit<GraphNode, "id">) => {
    if (!nodeMap.has(id)) nodeMap.set(id, { id, ...n });
  };

  const resolvedDeps = new Map<string, Set<string>>(); // formula node -> dep ids (cross-file aware)

  for (const m of models) {
    const sheetNames = new Set(m.sheets.map((s) => s.name));
    const refSet = referencedSheets.get(m.fileName) ?? new Set<string>();
    referencedSheets.set(m.fileName, refSet);

    for (const sheet of m.sheets) {
      const cellCount = Object.keys(sheet.cells).length;
      let fCount = 0;
      let eCount = 0;
      totalMerged += sheet.merges.length;
      totalCells += cellCount;

      for (const addr of Object.keys(sheet.cells)) {
        const cell = sheet.cells[addr];
        const a = addr.toUpperCase();

        if (cell.f) {
          fCount++;
          totalFormulas++;
          if (formulas.length < CAP_FORMULAS) {
            formulas.push({ sheet: sheet.name, cell: a, f: cell.f, file: m.fileName });
          } else formulasTruncated = true;

          const parsed = parseFormula(cell.f);
          for (const fn of parsed.functions) {
            funcCount.set(fn, (funcCount.get(fn) ?? 0) + 1);
            if (VOLATILE_FUNCTIONS.has(fn)) {
              totalVolatile++;
              if (volatileList.length < 500) volatileList.push({ sheet: sheet.name, cell: a, fn });
              push(
                risk("VOLATILE_FUNCTION", "warning", `Volatile function ${fn} used in formula`, `=${cell.f.slice(0, 120)}`, {
                  sheet: sheet.name, cell: a, file: m.fileName, ruleId: "T004", params: { fn },
                })
              );
            }
          }
          for (const num of parsed.numbers) {
            if (num === "0" || num === "1" || num === "100") continue;
            if (/^\d{1,4}$/.test(num) && parseInt(num, 10) <= 12) continue; // months etc noise
            totalHardcoded++;
            hardcodedList.push({ sheet: sheet.name, cell: a, literal: num, file: m.fileName });
            push(
              risk("HARDCODED_NUMBER", "info", `Hard-coded numeric literal ${num} inside formula`, `=${cell.f.slice(0, 120)}`, {
                sheet: sheet.name, cell: a, file: m.fileName, ruleId: "T001", params: { num },
              })
            );
          }

          const fromId = nid(m, sheet.name, a);
          addNode(fromId, { sheet: sheet.name, addr: a, formula: true, file: m.fileName });
          const depSet = new Set<string>();

          for (const ref of parsed.refs) {
            if (ref.book != null) {
              // external workbook reference
              const target = models.find(
                (x) =>
                  x.fileName !== m.fileName &&
                  x.fileName.toLowerCase() === ref.book!.toLowerCase()
              );
              const kind = target && opts.resolveCrossFile ? "cross-file" : "external";
              const toId = `EXT::${ref.book}]${ref.sheet ?? ""}!${addrOf(ref.r1, ref.c1)}`;
              addNode(toId, {
                sheet: ref.sheet ?? "?",
                addr: addrOf(ref.r1, ref.c1),
                formula: false,
                external: kind === "external",
                file: ref.book,
              });
              edges.push({ from: fromId, to: toId, kind });
              if (kind === "external") {
                push(
                  risk(
                    "EXTERNAL_LINK",
                    "error",
                    `Formula references external workbook [${ref.book}]`,
                    `=${cell.f.slice(0, 120)}`,
                    { sheet: sheet.name, cell: a, file: m.fileName, ruleId: "T003", params: { book: ref.book } }
                  )
                );
              } else if (target) {
                // resolved cross-file edge: link into target graph for cycle detection
                const tSheet = target.sheets.find((s) => s.name === ref.sheet);
                if (tSheet) {
                  const tNid = nid(target, tSheet.name, addrOf(ref.r1, ref.c1));
                  addNode(tNid, {
                    sheet: tSheet.name,
                    addr: addrOf(ref.r1, ref.c1),
                    formula: Boolean(tSheet.cells[addrOf(ref.r1, ref.c1)]?.f),
                    file: tSheet.name,
                  });
                  depSet.add(tNid);
                }
              }
              continue;
            }
            const targetSheetName = ref.sheet ?? sheet.name;
            refSet.add(targetSheetName);
            if (!sheetNames.has(targetSheetName)) {
              const toId = `MISSING::${targetSheetName}!${addrOf(ref.r1, ref.c1)}`;
              addNode(toId, { sheet: targetSheetName, addr: addrOf(ref.r1, ref.c1), formula: false, missing: true });
              edges.push({ from: fromId, to: toId, kind: "missing" });
              continue;
            }
            const span = (ref.r2 - ref.r1 + 1) * (ref.c2 - ref.c1 + 1);
            if (span > RANGE_EXPAND_CAP) {
              const toId = nid(m, targetSheetName, addrOf(ref.r1, ref.c1));
              addNode(toId, { sheet: targetSheetName, addr: addrOf(ref.r1, ref.c1) + "…", formula: false, file: m.fileName });
              edges.push({ from: fromId, to: toId, kind: ref.sheet ? "cross" : "intra" });
              depSet.add(toId);
              continue;
            }
            for (let rr = ref.r1; rr <= ref.r2; rr++) {
              for (let cc = ref.c1; cc <= ref.c2; cc++) {
                const tAddr = addrOf(rr, cc);
                const toId = nid(m, targetSheetName, tAddr);
                const tCell = m.sheets.find((s) => s.name === targetSheetName)?.cells[tAddr];
                addNode(toId, {
                  sheet: targetSheetName,
                  addr: tAddr,
                  formula: Boolean(tCell?.f),
                  file: m.fileName,
                });
                edges.push({ from: fromId, to: toId, kind: ref.sheet ? "cross" : "intra" });
                depSet.add(toId);
              }
            }
          }
          depMap.set(fromId, depSet);
          resolvedDeps.set(fromId, depSet);
        }

        if (cell.t === "e") {
          eCount++;
          errorCells++;
          push(
            risk("ERROR_CELL", "error", `Cell contains error value ${String(cell.v)}`, cell.f ? `=${cell.f.slice(0, 120)}` : "Static error literal", {
              sheet: sheet.name, cell: a, file: m.fileName, ruleId: "T011", params: { err: String(cell.v) },
            })
          );
        }

        if (typeof cell.v === "string" && !cell.f) {
          const s = cell.v;
          if (hasWsIssue(s)) {
            push(
              risk("WHITESPACE", "info", "Text has stray whitespace (space / NBSP / ideographic space)", JSON.stringify(s.slice(0, 60)), {
                sheet: sheet.name, cell: a, file: m.fileName, ruleId: "T007",
              })
            );
          }
          if (FULLWIDTH.test(s)) {
            push(
              risk("UNICODE_FULLWIDTH", "info", "Contains full-width characters that break lookups/exports", JSON.stringify(s.slice(0, 60)), {
                sheet: sheet.name, cell: a, file: m.fileName, ruleId: "T009",
              })
            );
          }
          if (MOJIBAKE.test(s)) {
            push(
              risk("ENCODING", "warning", "Possible mojibake / invalid UTF-8 sequence detected", JSON.stringify(s.slice(0, 60)), {
                sheet: sheet.name, cell: a, file: m.fileName,
              })
            );
          }
          if (WS_DATE.test(s.trim())) {
            push(
              risk("DATE_AS_TEXT", "info", "Date stored as text — sorting and date math will fail", s.trim().slice(0, 40), {
                sheet: sheet.name, cell: a, file: m.fileName, ruleId: "T010",
              })
            );
          } else if (NUMERIC_TEXT.test(s.trim()) || (PLAIN_NUMERIC_TEXT.test(s.trim()) && s.trim().length > 0 && /,|％|%/.test(s) === false && s.trim().length >= 5)) {
            push(
              risk("NUMBER_AS_TEXT", "info", "Numeric value stored as text (possible thousands separators)", s.trim().slice(0, 40), {
                sheet: sheet.name, cell: a, file: m.fileName, ruleId: "T013",
              })
            );
          }
        }
      }

      // sheet-level structural risks
      if (cellCount === 0) {
        push(risk("EMPTY_SHEET", "info", "Sheet is empty", `Sheet '${sheet.name}' contains no data`, { sheet: sheet.name, file: m.fileName }));
      }
      if (sheet.visibility !== "visible") {
        const inbound = referencedSheets.get(m.fileName)?.has(sheet.name) ?? false;
        push(
          risk("HIDDEN_SHEET", inbound ? "warning" : "info",
            `${sheet.visibility === "veryHidden" ? "Very-hidden" : "Hidden"} sheet${inbound ? " is referenced by formulas" : ""}`,
            `Sheet '${sheet.name}' visibility=${sheet.visibility}${inbound ? "; other sheets depend on it" : ""}`,
            { sheet: sheet.name, file: m.fileName, params: { vis: sheet.visibility } })
        );
      }
      if (sheet.merges.length > 0) {
        push(
          risk("MERGED_CELLS", "warning", `${sheet.merges.length} merged range(s) — breaks sorting, filtering and pivots`,
            `Merged ranges in '${sheet.name}': ${sheet.merges.slice(0, 6).map((x) => `${addrOf(x.r1, x.c1)}:${addrOf(x.r2, x.c2)}`).join(", ")}${sheet.merges.length > 6 ? "…" : ""}`,
            { sheet: sheet.name, file: m.fileName, ruleId: "T005", count: sheet.merges.length })
        );
      }

      sheets.push({
        name: sheet.name,
        visibility: sheet.visibility,
        rows: sheet.rows,
        cols: sheet.cols,
        cells: cellCount,
        formulas: fCount,
        errors: eCount,
        file: m.fileName,
      });
    }

    // per-file pass: column patterns, duplicates, mixed types
    for (const sheet of m.sheets) {
      analyzeColumns(m, sheet, push);
      analyzeDuplicates(m, sheet, push);
      analyzeInconsistent(m, sheet, push);
    }

    // named ranges
    const seen = new Set<string>();
    for (const n of m.names) {
      if (n.broken) {
        push(
          risk("BROKEN_NAMED_RANGE", "error", `Named range '${n.name}' is broken (#REF!)`, `${n.name} → ${n.ref}`, {
            file: m.fileName, ruleId: "T006", params: { name: n.name },
          })
        );
      }
      const key = n.name.toLowerCase();
      if (seen.has(key)) {
        push(risk("BROKEN_NAMED_RANGE", "warning", `Duplicate named range '${n.name}'`, `Multiple definitions of '${n.name}'`, { file: m.fileName, ruleId: "T006" }));
      }
      seen.add(key);
    }
  }

  // ── cycles (Tarjan SCC, iterative) ───────────────────────────────────────
  const sccs = tarjan(depMap);
  let circularCount = 0;
  for (const comp of sccs) {
    if (comp.length === 1 && !depMap.get(comp[0])?.has(comp[0])) continue;
    circularCount += comp.length;
    const loc = comp[0].split("::").pop()!.split("!");
    comp.forEach((idn) => nodeMap.get(idn) && (nodeMap.get(idn)!.cycle = true));
    for (const e of edges) if (comp.includes(e.from) && comp.includes(e.to)) e.cycle = true;
    push(
      risk("CIRCULAR_REF", "critical", `Circular reference across ${comp.length} cell(s)`,
        comp.slice(0, 8).map((x) => x.split("::").pop()).join(" → ") + (comp.length > 8 ? " → …" : ""),
        { sheet: loc[0], cell: loc[1], count: comp.length })
    );
  }

  // ── long formulas ────────────────────────────────────────────────────────
  for (const fr of formulas) {
    if (fr.f.length > 500) {
      push(risk("LONG_FORMULA", "info", `Extremely long formula (${fr.f.length} chars) — consider splitting into helper cells`, `=${fr.f.slice(0, 100)}…`, { sheet: fr.sheet, cell: fr.cell, file: fr.file }));
    }
  }

  // ── metrics ──────────────────────────────────────────────────────────────
  const risksBySeverity: Record<Severity, number> = { critical: 0, error: 0, warning: 0, info: 0 };
  for (const t of Object.keys(counts) as RiskType[]) {
    const sev = risks.find((r) => r.type === t)?.severity ?? "info";
    risksBySeverity[sev] += counts[t] ?? 0;
  }
  const weights: Record<Severity, number> = { critical: 25, error: 8, warning: 3, info: 1 };
  const wsum = (Object.keys(risksBySeverity) as Severity[]).reduce((acc, s) => acc + weights[s] * risksBySeverity[s], 0);
  const riskScore = Math.min(100, Math.round((100 * wsum) / (wsum + 60 + totalCells / 20)));
  const metrics: AnalysisMetrics = {
    files: models.length,
    sheets: sheets.length,
    cells: totalCells,
    formulas: totalFormulas,
    functions: [...funcCount.values()].reduce((a, b) => a + b, 0),
    volatile: totalVolatile,
    circular: circularCount,
    externalLinks: counts["EXTERNAL_LINK"] ?? 0,
    merged: totalMerged,
    hiddenSheets: sheets.filter((s) => s.visibility !== "visible").length,
    hardcoded: totalHardcoded,
    names: models.reduce((a, m) => a + m.names.length, 0),
    brokenNames: counts["BROKEN_NAMED_RANGE"] ?? 0,
    duplicateRows: counts["DUPLICATE_ROWS"] ?? 0,
    errorCells,
    risksBySeverity,
    riskScore,
    healthScore: 100 - riskScore,
  };

  // assign stable risk ids
  risks.forEach((r, i) => (r.id = `R-${String(i + 1).padStart(4, "0")}`));

  // graph sampling
  let nodesArr = [...nodeMap.values()];
  let edgesArr = edges;
  let graphTruncated = false;
  if (nodesArr.length > CAP_GRAPH_NODES || edgesArr.length > CAP_GRAPH_EDGES) {
    graphTruncated = true;
    const keepNodes = new Set(nodesArr.slice(0, CAP_GRAPH_NODES).map((n) => n.id));
    edgesArr = edges.filter((e) => keepNodes.has(e.from) && keepNodes.has(e.to)).slice(0, CAP_GRAPH_EDGES);
    nodesArr = nodesArr.slice(0, CAP_GRAPH_NODES);
  }

  const graph: DependencyGraph = { nodes: nodesArr, edges: edgesArr, truncated: graphTruncated };
  void resolvedDeps;

  const result: AnalysisResult = {
    name: opts.name ?? metas[0]?.name ?? "analysis",
    language: opts.language ?? "en",
    files: metas.map((mt) => {
      const m = models.find((x) => x.fileName === mt.name);
      return {
        id: mt.id,
        name: mt.name,
        size: mt.size,
        encoding: mt.encoding,
        sheets: m?.sheets.length ?? 0,
        formulas: m ? m.sheets.reduce((a, s) => a + Object.values(s.cells).filter((c) => c.f).length, 0) : 0,
        cells: m ? m.sheets.reduce((a, s) => a + Object.keys(s.cells).length, 0) : 0,
      };
    }),
    sheets,
    risks,
    riskCounts: counts,
    metrics,
    graph,
    formulas,
    formulasTruncated,
    volatileList,
    hardcodedList,
    model: models[0] ?? { fileId: "", fileName: "", sheets: [], names: [] },
  };
  // attach extra models for multi-file batch
  (result as AnalysisResult & { models?: WorkbookModel[] }).models = models;
  return result;
}

// ── column-level heuristics ──────────────────────────────────────────────────

type PushFn = (r: Risk) => void;

function analyzeColumns(m: WorkbookModel, sheet: SheetModel, push: PushFn): void {
  const perCol = new Map<number, { n: number; s: number; first: string; rows: number }>();
  for (const addr of Object.keys(sheet.cells)) {
    const cell = sheet.cells[addr];
    if (cell.f) continue;
    if (cell.r === 0 && sheet.cells[addrOf(1, cell.c)]) continue; // likely header
    const slot = perCol.get(cell.c) ?? { n: 0, s: 0, first: addr, rows: 0 };
    if (cell.t === "n" || cell.t === "d") slot.n++;
    else if (cell.t === "s" && String(cell.v).trim() !== "") slot.s++;
    slot.rows++;
    perCol.set(cell.c, slot);
  }
  for (const [c, stat] of perCol) {
    const total = stat.n + stat.s;
    if (total < 8) continue;
    const mix = Math.min(stat.n, stat.s) / total;
    if (stat.n >= 4 && stat.s >= 4 && mix >= 0.15) {
      push(
        risk("MIXED_TYPES", "warning", `Column ${addrOf(0, c).replace(/1$/, "")} mixes numbers (${stat.n}) and text (${stat.s})`,
          `Mixed data types in column starting at ${stat.first} of '${sheet.name}'`,
          { sheet: sheet.name, cell: stat.first, file: m.fileName, params: { col: addrOf(0, c).replace(/\d+$/, ""), n: stat.n, s: stat.s } })
      );
    }
  }
}

function analyzeDuplicates(m: WorkbookModel, sheet: SheetModel, push: PushFn): void {
  if (sheet.rows < 3) return;
  const sigRows = new Map<string, number>();
  const dups: { row: number; first: number; preview: string }[] = [];
  for (let r = 0; r < sheet.rows; r++) {
    const vals: unknown[] = [];
    let nonEmpty = 0;
    for (let c = 0; c < Math.min(sheet.cols, 60); c++) {
      const cell = sheet.cells[addrOf(r, c)];
      const v = cell?.v ?? null;
      if (v !== null && v !== "") nonEmpty++;
      vals.push(cell?.f ? `=${cell.f}` : v);
    }
    if (nonEmpty < 2) continue;
    const sig = JSON.stringify(vals);
    const prev = sigRows.get(sig);
    if (prev === undefined) sigRows.set(sig, r);
    else dups.push({ row: r, first: prev, preview: vals.slice(0, 4).map((x) => String(x ?? "")).join(" | ").slice(0, 80) });
  }
  if (dups.length > 0) {
    push(
      risk("DUPLICATE_ROWS", "warning", `${dups.length} duplicate row(s) detected`,
        dups.slice(0, 5).map((d) => `Row ${d.row + 1} duplicates row ${d.first + 1}`).join("; ") + (dups.length > 5 ? "; …" : ""),
        { sheet: sheet.name, file: m.fileName, ruleId: "T008", count: dups.length })
    );
  }
}

function analyzeInconsistent(m: WorkbookModel, sheet: SheetModel, push: PushFn): void {
  const perCol = new Map<number, { r: number; f: string }[]>();
  for (const addr of Object.keys(sheet.cells)) {
    const cell = sheet.cells[addr];
    if (!cell.f) continue;
    const arr = perCol.get(cell.c) ?? [];
    arr.push({ r: cell.r, f: cell.f });
    perCol.set(cell.c, arr);
  }
  for (const [c, arr] of perCol) {
    arr.sort((a, b) => a.r - b.r);
    // split into contiguous segments (row gap <= 1)
    let seg: { r: number; f: string }[] = [];
    const segments: { r: number; f: string }[][] = [];
    for (const item of arr) {
      if (seg.length && item.r - seg[seg.length - 1].r > 1) {
        segments.push(seg);
        seg = [];
      }
      seg.push(item);
    }
    if (seg.length) segments.push(seg);
    for (const segment of segments) {
      if (segment.length < 3) continue;
      const canonCount = new Map<string, number>();
      const canonOf = segment.map((it) => {
        const canon = abstractFormula(it.f, it.r, c);
        canonCount.set(canon, (canonCount.get(canon) ?? 0) + 1);
        return canon;
      });
      let majority = "";
      let majorityN = 0;
      for (const [k, v] of canonCount) if (v > majorityN) { majority = k; majorityN = v; }
      segment.forEach((it, i) => {
        if (canonOf[i] !== majority) {
          push(
            risk("INCONSISTENT_FORMULA", "warning", "Formula deviates from the column pattern used by neighbouring cells",
              `=${it.f.slice(0, 120)} — ${majorityN}/${segment.length} rows in this range share a different pattern`,
              { sheet: sheet.name, cell: addrOf(it.r, c), file: m.fileName, ruleId: "T002", params: { majority: majorityN, total: segment.length } })
          );
        }
      });
    }
  }
}

// ── Tarjan SCC (iterative) ───────────────────────────────────────────────────

export function tarjan(graph: Map<string, Set<string>>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let counter = 0;

  for (const start of graph.keys()) {
    if (index.has(start)) continue;
    const work: { node: string; it: Iterator<string> }[] = [{ node: start, it: (graph.get(start) ?? new Set<string>()).values() }];
    index.set(start, counter);
    low.set(start, counter);
    counter++;
    stack.push(start);
    onStack.add(start);
    while (work.length) {
      const top = work[work.length - 1];
      const next = top.it.next();
      if (!next.done) {
        const w = next.value as string;
        if (!graph.has(w)) continue;
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter);
          counter++;
          stack.push(w);
          onStack.add(w);
          work.push({ node: w, it: (graph.get(w) ?? new Set<string>()).values() });
        } else if (onStack.has(w)) {
          low.set(top.node, Math.min(low.get(top.node)!, index.get(w)!));
        }
      } else {
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1].node;
          low.set(parent, Math.min(low.get(parent)!, low.get(top.node)!));
        }
        if (low.get(top.node) === index.get(top.node)) {
          const comp: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            comp.push(w);
          } while (w !== top.node);
          sccs.push(comp);
        }
      }
    }
  }
  return sccs;
}

/** Lightweight re-score of a model after transforms (used by preview risk-delta). */
export function rescoreModel(model: WorkbookModel, opts: AnalyzeOptions = {}): number {
  const r = analyzeAll([model], [{ id: model.fileId, name: model.fileName, size: 0 }], opts);
  return r.metrics.riskScore;
}

export function allModels(result: AnalysisResult): WorkbookModel[] {
  const extra = (result as AnalysisResult & { models?: WorkbookModel[] }).models;
  if (extra && extra.length) return extra;
  return [result.model];
}
