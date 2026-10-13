// ── Deterministic transformation rules T001–T013 with structured diffs ───────
import type { Diff, ToolDef, TransformOutput, WorkbookModel, SheetModel, CellModel } from "./types";
import { VOLATILE_FUNCTIONS } from "./types";
import {
  abstractFormula,
  addrOf,
  instantiateTemplate,
  parseFormula,
  replaceNumberLiteral,
} from "./formula";

export const TOOLS: ToolDef[] = [
  { id: "T005", group: "organize", name: "Unmerge cells", desc: "Unmerge all merged ranges and fill every cell with the anchor value so sorting, filtering and pivots work.", safeDefault: true, autoFix: true, targets: ["MERGED_CELLS"], nameKey: "tool.T005.name", descKey: "tool.T005.desc" },
  { id: "T002", group: "organize", name: "Normalize inconsistent formulas", desc: "Detect the majority formula pattern per column range and rewrite deviating cells to match it.", safeDefault: true, autoFix: true, targets: ["INCONSISTENT_FORMULA"], nameKey: "tool.T002.name", descKey: "tool.T002.desc" },
  { id: "T001", group: "organize", name: "Extract hard-coded parameters", desc: "Repeated numeric literals inside formulas are moved to a Parameters sheet with named ranges; formulas reference the names.", safeDefault: false, autoFix: false, targets: ["HARDCODED_NUMBER"], nameKey: "tool.T001.name", descKey: "tool.T001.desc" },
  { id: "T006", group: "organize", name: "Repair named ranges", desc: "Remove broken (#REF!) and duplicate named ranges so lookups stop erroring.", safeDefault: true, autoFix: false, targets: ["BROKEN_NAMED_RANGE"], nameKey: "tool.T006.name", descKey: "tool.T006.desc" },
  { id: "T007", group: "clean", name: "Trim & normalize whitespace", desc: "Remove leading/trailing spaces, convert NBSP and ideographic spaces to normal spaces.", safeDefault: true, autoFix: true, targets: ["WHITESPACE"], nameKey: "tool.T007.name", descKey: "tool.T007.desc" },
  { id: "T009", group: "clean", name: "Normalize Unicode (full-width → half-width)", desc: "Convert full-width romaji/digits to ASCII and normalize text to NFC for stable joins and exports.", safeDefault: true, autoFix: true, targets: ["UNICODE_FULLWIDTH"], nameKey: "tool.T009.name", descKey: "tool.T009.desc" },
  { id: "T010", group: "clean", name: "Coerce dates stored as text", desc: "Parse YYYY/MM/DD, YYYY-MM-DD and Japanese YYYY年M月D日 strings into real date cells.", safeDefault: true, autoFix: false, targets: ["DATE_AS_TEXT"], nameKey: "tool.T010.name", descKey: "tool.T010.desc" },
  { id: "T013", group: "clean", name: "Coerce numbers stored as text", desc: "Convert comma-grouped numeric text (1,234,567) into real numbers for math and pivots.", safeDefault: true, autoFix: false, targets: ["NUMBER_AS_TEXT"], nameKey: "tool.T013.name", descKey: "tool.T013.desc" },
  { id: "T008", group: "clean", name: "Deduplicate rows", desc: "Remove exact duplicate data rows (first occurrence kept; remaining rows shift up).", safeDefault: false, autoFix: false, targets: ["DUPLICATE_ROWS"], nameKey: "tool.T008.name", descKey: "tool.T008.desc" },
  { id: "T003", group: "mitigate", name: "Snapshot external links", desc: "Replace references to external workbooks with their cached snapshot values; an audit table of original references is written to a SourceData sheet.", safeDefault: false, autoFix: true, targets: ["EXTERNAL_LINK"], nameKey: "tool.T003.name", descKey: "tool.T003.desc" },
  { id: "T004", group: "mitigate", name: "Freeze volatile functions", desc: "Replace NOW/TODAY/RAND/OFFSET/INDIRECT formulas with their last cached values for reproducible results.", safeDefault: false, autoFix: false, targets: ["VOLATILE_FUNCTION"], nameKey: "tool.T004.name", descKey: "tool.T004.desc" },
  { id: "T011", group: "mitigate", name: "Guard error cells (IFERROR)", desc: "Wrap formulas that currently evaluate to #REF!, #DIV/0!, #N/A etc. in IFERROR; blank static error literals.", safeDefault: true, autoFix: true, targets: ["ERROR_CELL"], nameKey: "tool.T011.name", descKey: "tool.T011.desc" },
];

export const AUTOFIX_TOOLS = TOOLS.filter((t) => t.autoFix).map((t) => t.id);

export function toolById(id: string): ToolDef | undefined {
  return TOOLS.find((t) => t.id === id);
}

const MAX_DIFFS = 2000;
const DATE_TEXT = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$|^(\d{4})年(\d{1,2})月(\d{1,2})日(?:[（(][日月火水木金土][)）])?$/;
const COMMA_NUM = /^(-?\d{1,3}(?:,\d{3})+)(?:\.(\d+))?$/;

interface Ctx {
  diffs: Diff[];
  byTool: Record<string, number>;
  total: number;
}

function pushDiff(ctx: Ctx, d: Diff) {
  ctx.byTool[d.ruleId] = (ctx.byTool[d.ruleId] ?? 0) + 1;
  ctx.total++;
  if (ctx.diffs.length < MAX_DIFFS) ctx.diffs.push(d);
}

function forEachSheet(models: WorkbookModel[], fn: (sheet: SheetModel, m: WorkbookModel) => void) {
  for (const m of models) for (const s of m.sheets) fn(s, m);
}

function cellOf(sheet: SheetModel, r: number, c: number): CellModel | undefined {
  return sheet.cells[addrOf(r, c)];
}

// ── individual rules ─────────────────────────────────────────────────────────

const NBSP = String.fromCharCode(0xa0);
const IDEO_SPACE = String.fromCharCode(0x3000);

function t007Trim(models: WorkbookModel[], ctx: Ctx) {
  forEachSheet(models, (sheet) => {
    for (const addr of Object.keys(sheet.cells)) {
      const cell = sheet.cells[addr];
      if (cell.t !== "s" || typeof cell.v !== "string" || cell.f) continue;
      const nv = cell.v.split(NBSP).join(" ").split(IDEO_SPACE).join(" ").trim();
      if (nv !== cell.v) {
        pushDiff(ctx, {
          sheet: sheet.name, cell: addr.toUpperCase(), before: cell.v, after: nv, kind: "value",
          ruleId: "T007", reason: "Removed stray whitespace / NBSP / ideographic space",
          confidence: 0.99, riskDelta: "down",
        });
        cell.v = nv;
      }
    }
  });
}

function toHalfWidth(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code === 0x3000) out += " ";
    else if (code >= 0xff01 && code <= 0xff5e) out += String.fromCharCode(code - 0xfee0);
    else out += ch;
  }
  return out.normalize("NFC");
}

function t009Unicode(models: WorkbookModel[], ctx: Ctx) {
  forEachSheet(models, (sheet) => {
    for (const addr of Object.keys(sheet.cells)) {
      const cell = sheet.cells[addr];
      if (cell.f) continue;
      if (cell.t === "s" && typeof cell.v === "string") {
        const nv = toHalfWidth(cell.v);
        if (nv !== cell.v) {
          pushDiff(ctx, {
            sheet: sheet.name, cell: addr.toUpperCase(), before: cell.v, after: nv, kind: "value",
            ruleId: "T009", reason: "Converted full-width characters to half-width ASCII (NFC)",
            confidence: 0.97, riskDelta: "down",
          });
          cell.v = nv;
        }
      }
    }
  });
}

function t010Dates(models: WorkbookModel[], ctx: Ctx) {
  forEachSheet(models, (sheet) => {
    for (const addr of Object.keys(sheet.cells)) {
      const cell = sheet.cells[addr];
      if (cell.t !== "s" || typeof cell.v !== "string" || cell.f) continue;
      const m = DATE_TEXT.exec(cell.v.trim());
      if (!m) continue;
      const y = parseInt(m[1] ?? m[4], 10);
      const mo = parseInt(m[2] ?? m[5], 10);
      const d = parseInt(m[3] ?? m[6], 10);
      if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
      const dt = new Date(Date.UTC(y, mo - 1, d));
      // Date.UTC normalizes overflow (e.g. February 31 into March); only
      // accept a parsed date when every calendar component round-trips.
      if (
        isNaN(dt.getTime()) ||
        dt.getUTCFullYear() !== y ||
        dt.getUTCMonth() !== mo - 1 ||
        dt.getUTCDate() !== d
      ) continue;
      pushDiff(ctx, {
        sheet: sheet.name, cell: addr.toUpperCase(), before: cell.v, after: dt.toISOString().slice(0, 10),
        kind: "value", ruleId: "T010", reason: "Converted date text to a real date cell",
        confidence: 0.95, riskDelta: "down",
      });
      cell.t = "d";
      cell.v = dt.toISOString();
    }
  });
}

function t013Numbers(models: WorkbookModel[], ctx: Ctx) {
  forEachSheet(models, (sheet) => {
    for (const addr of Object.keys(sheet.cells)) {
      const cell = sheet.cells[addr];
      if (cell.t !== "s" || typeof cell.v !== "string" || cell.f) continue;
      const m = COMMA_NUM.exec(cell.v.trim());
      if (!m) continue;
      const n = Number(`${m[1].replace(/,/g, "")}${m[2] ? "." + m[2] : ""}`);
      if (isNaN(n)) continue;
      pushDiff(ctx, {
        sheet: sheet.name, cell: addr.toUpperCase(), before: cell.v, after: n, kind: "value",
        ruleId: "T013", reason: "Converted comma-grouped numeric text to a number",
        confidence: 0.96, riskDelta: "down",
      });
      cell.t = "n";
      cell.v = n;
    }
  });
}

function t008Dedupe(models: WorkbookModel[], ctx: Ctx) {
  forEachSheet(models, (sheet) => {
    if (sheet.rows < 3) return;
    // snapshot rows
    const rowsCells: CellModel[][] = [];
    for (let r = 0; r < sheet.rows; r++) {
      const row: CellModel[] = [];
      for (let c = 0; c < sheet.cols; c++) {
        const cell = cellOf(sheet, r, c);
        if (cell) row.push(cell);
      }
      rowsCells.push(row);
    }
    const seen = new Set<string>();
    const keep: number[] = [];
    const removed: { r: number; preview: string; first: number }[] = [];
    rowsCells.forEach((row, r) => {
      const vals = row.map((c) => (c.f ? `=${c.f}` : c.v));
      const nonEmpty = vals.filter((v) => v !== null && v !== "").length;
      if (nonEmpty < 2) {
        keep.push(r);
        return;
      }
      const sig = JSON.stringify(vals);
      if (seen.has(sig)) {
        removed.push({
          r,
          first: -1,
          preview: vals.slice(0, 4).map((x) => String(x ?? "")).join(" | ").slice(0, 90),
        });
      } else {
        seen.add(sig);
        keep.push(r);
      }
    });
    if (!removed.length) return;
    const rowEligible = sheet.merges.length === 0; // with merges present, shifting is unsafe
    if (!rowEligible) {
      // keep merges intact: do not shift, just report
      return;
    }
    // rebuild cells
    const newCells: Record<string, CellModel> = {};
    keep.forEach((oldR, newR) => {
      rowsCells[oldR].forEach((cell) => {
        const nc: CellModel = { ...cell, r: newR, a: addrOf(newR, cell.c) };
        newCells[nc.a] = nc;
      });
    });
    removed.forEach((rm) => {
      pushDiff(ctx, {
        sheet: sheet.name, cell: `A${rm.r + 1}`, before: rm.preview, after: null, kind: "row",
        ruleId: "T008", reason: `Removed duplicate row ${rm.r + 1} (identical to an earlier row)`,
        confidence: 0.93, riskDelta: "down",
      });
    });
    sheet.cells = newCells;
    let maxR = 0;
    for (const k of Object.keys(newCells)) maxR = Math.max(maxR, newCells[k].r + 1);
    sheet.rows = Math.max(maxR, 1);
  });
}

function t005Unmerge(models: WorkbookModel[], ctx: Ctx) {
  forEachSheet(models, (sheet) => {
    if (!sheet.merges.length) return;
    for (const mg of sheet.merges) {
      const tl = cellOf(sheet, mg.r1, mg.c1);
      const rangeStr = `${addrOf(mg.r1, mg.c1)}:${addrOf(mg.r2, mg.c2)}`;
      let filled = 0;
      for (let r = mg.r1; r <= mg.r2; r++) {
        for (let c = mg.c1; c <= mg.c2; c++) {
          if (r === mg.r1 && c === mg.c1) continue;
          const a = addrOf(r, c);
          if (sheet.cells[a]) continue;
          const nv = tl?.v ?? "";
          sheet.cells[a] = { a, r, c, t: tl?.t ?? "s", v: nv };
          filled++;
          pushDiff(ctx, {
            sheet: sheet.name, cell: a, before: null, after: typeof nv === "string" || typeof nv === "number" ? nv : String(nv),
            kind: "structure", ruleId: "T005",
            reason: `Unmerged range ${rangeStr} — filled with anchor value`,
            confidence: 0.98, riskDelta: "down",
          });
        }
      }
      if (!filled) {
        // merge had content in every cell already — still record the structural change
        pushDiff(ctx, {
          sheet: sheet.name, cell: addrOf(mg.r1, mg.c1), before: `merged ${rangeStr}`, after: "(unmerged)",
          kind: "structure", ruleId: "T005",
          reason: `Removed merge ${rangeStr} (all cells already had values)`,
          confidence: 0.98, riskDelta: "down",
        });
      }
    }
    sheet.merges = [];
  });
}

function t011GuardErrors(models: WorkbookModel[], ctx: Ctx) {
  forEachSheet(models, (sheet) => {
    for (const addr of Object.keys(sheet.cells)) {
      const cell = sheet.cells[addr];
      if (cell.t !== "e") continue;
      if (cell.f) {
        const before = `=${cell.f}`;
        if (/^IFERROR\(/i.test(cell.f.trim())) continue;
        cell.f = `IFERROR(${cell.f},"")`;
        cell.t = "s";
        cell.v = "";
        pushDiff(ctx, {
          sheet: sheet.name, cell: addr.toUpperCase(), before, after: `=${cell.f}`, kind: "formula",
          ruleId: "T011", reason: "Wrapped error-producing formula in IFERROR",
          confidence: 0.94, riskDelta: "down",
        });
      } else {
        pushDiff(ctx, {
          sheet: sheet.name, cell: addr.toUpperCase(), before: String(cell.v ?? ""), after: "", kind: "value",
          ruleId: "T011", reason: "Blanked static error literal",
          confidence: 0.9, riskDelta: "down",
        });
        cell.t = "s";
        cell.v = "";
      }
    }
  });
}

function t004FreezeVolatile(models: WorkbookModel[], ctx: Ctx) {
  forEachSheet(models, (sheet) => {
    for (const addr of Object.keys(sheet.cells)) {
      const cell = sheet.cells[addr];
      if (!cell.f) continue;
      const parsed = parseFormula(cell.f);
      const vols = parsed.functions.filter((fn) => VOLATILE_FUNCTIONS.has(fn));
      if (!vols.length) continue;
      if (cell.v === null || cell.v === undefined || cell.t === "e") continue; // nothing cached to freeze
      const before = `=${cell.f}`;
      delete cell.f;
      pushDiff(ctx, {
        sheet: sheet.name, cell: addr.toUpperCase(), before,
        after: typeof cell.v === "string" || typeof cell.v === "number" ? cell.v : String(cell.v),
        kind: "formula", ruleId: "T004",
        reason: `Froze volatile function(s) ${[...new Set(vols)].join(", ")} to cached value`,
        params: { fn: [...new Set(vols)].join(",") }, confidence: 0.9, riskDelta: "down",
      });
    }
  });
}

function t003SnapshotExternal(models: WorkbookModel[], ctx: Ctx) {
  for (const m of models) {
    const snapshots: { sheet: string; cell: string; ref: string; value: unknown }[] = [];
    for (const sheet of m.sheets) {
      for (const addr of Object.keys(sheet.cells)) {
        const cell = sheet.cells[addr];
        if (!cell.f) continue;
        const parsed = parseFormula(cell.f);
        const ext = parsed.refs.filter((r) => r.book != null);
        if (!ext.length) continue;
        const before = `=${cell.f}`;
        ext.forEach((r) =>
          snapshots.push({ sheet: sheet.name, cell: addr.toUpperCase(), ref: r.raw, value: cell.v })
        );
        delete cell.f;
        if (cell.v === null || cell.v === undefined || cell.t === "e") {
          cell.t = "s";
          cell.v = "";
        }
        pushDiff(ctx, {
          sheet: sheet.name, cell: addr.toUpperCase(), before,
          after: typeof cell.v === "string" || typeof cell.v === "number" ? cell.v : String(cell.v),
          kind: "formula", ruleId: "T003",
          reason: `Snapshotted external reference(s) to [${[...new Set(ext.map((e) => e.book))].join(", ")}] as local values`,
          confidence: 0.92, riskDelta: "down",
        });
      }
    }
    if (snapshots.length) {
      const rows: unknown[][] = [
        ["Source Sheet", "Cell", "External Reference", "Snapshot Value", "Rule"],
        ...snapshots.map((s) => [s.sheet, s.cell, s.ref, s.value ?? "", "T003"]),
      ];
      const sheet: SheetModel = { name: "SourceData", visibility: "visible", rows: rows.length, cols: 5, cells: {}, merges: [] };
      rows.forEach((row, r) => {
        row.forEach((v, c) => {
          if (v === null || v === undefined) return;
          const a = addrOf(r, c);
          sheet.cells[a] = { a, r, c, t: typeof v === "number" ? "n" : "s", v: v as string | number };
        });
      });
      m.sheets = m.sheets.filter((s) => s.name !== "SourceData");
      m.sheets.push(sheet);
      pushDiff(ctx, {
        sheet: "SourceData", cell: "A1", before: null, after: `${snapshots.length} snapshot record(s)`,
        kind: "structure", ruleId: "T003", reason: "Wrote SourceData relink/snapshot audit sheet",
        confidence: 1, riskDelta: "neutral",
      });
    }
  }
}

function t006RepairNames(models: WorkbookModel[], ctx: Ctx) {
  for (const m of models) {
    const seen = new Set<string>();
    const kept = [];
    for (const n of m.names) {
      const key = n.name.toLowerCase();
      if (n.broken) {
        pushDiff(ctx, {
          sheet: "-", cell: "-", before: `${n.name} → ${n.ref}`, after: "(removed)", kind: "name",
          ruleId: "T006", reason: `Removed broken named range '${n.name}' (#REF!)`,
          confidence: 0.95, riskDelta: "down",
        });
        continue;
      }
      if (seen.has(key)) {
        pushDiff(ctx, {
          sheet: "-", cell: "-", before: `${n.name} → ${n.ref}`, after: "(duplicate removed)", kind: "name",
          ruleId: "T006", reason: `Removed duplicate named range '${n.name}'`,
          confidence: 0.95, riskDelta: "down",
        });
        continue;
      }
      seen.add(key);
      kept.push(n);
    }
    m.names = kept;
  }
}

function t002Normalize(models: WorkbookModel[], ctx: Ctx) {
  forEachSheet(models, (sheet) => {
    const perCol = new Map<number, { r: number; cell: CellModel }[]>();
    for (const addr of Object.keys(sheet.cells)) {
      const cell = sheet.cells[addr];
      if (!cell.f) continue;
      const arr = perCol.get(cell.c) ?? [];
      arr.push({ r: cell.r, cell });
      perCol.set(cell.c, arr);
    }
    for (const [c, arr] of perCol) {
      arr.sort((a, b) => a.r - b.r);
      let seg: { r: number; cell: CellModel }[] = [];
      const segments: { r: number; cell: CellModel }[][] = [];
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
        const canons = segment.map((it) => {
          const canon = abstractFormula(it.cell.f!, it.r, c);
          canonCount.set(canon, (canonCount.get(canon) ?? 0) + 1);
          return canon;
        });
        let majority = "";
        let majorityN = 0;
        for (const [k, v] of canonCount) if (v > majorityN) { majority = k; majorityN = v; }
        segment.forEach((it, i) => {
          if (canons[i] === majority) return;
          const before = `=${it.cell.f}`;
          const nf = instantiateTemplate(majority, it.r, c);
          it.cell.f = nf;
          pushDiff(ctx, {
            sheet: sheet.name, cell: addrOf(it.r, c), before, after: `=${nf}`, kind: "formula",
            ruleId: "T002",
            reason: `Aligned to majority column pattern (${majorityN}/${segment.length} cells share it)`,
            params: { majority: majorityN, total: segment.length },
            confidence: 0.88, riskDelta: "down",
          });
        });
      }
    }
  });
}

function t001ExtractParams(models: WorkbookModel[], ctx: Ctx, opts: { minOccurrences: number }) {
  for (const m of models) {
    // count literal usage
    const usage = new Map<string, { count: number; cells: string[] }>();
    for (const sheet of m.sheets) {
      for (const addr of Object.keys(sheet.cells)) {
        const cell = sheet.cells[addr];
        if (!cell.f) continue;
        const parsed = parseFormula(cell.f);
        for (const num of parsed.numbers) {
          if (num === "0" || num === "1" || num === "100") continue;
          const f = Number(num);
          if (isNaN(f) || Math.abs(f) < 2) continue;
          const slot = usage.get(num) ?? { count: 0, cells: [] };
          slot.count++;
          slot.cells.push(`${sheet.name}!${addr.toUpperCase()}`);
          usage.set(num, slot);
        }
      }
    }
    const candidates = [...usage.entries()]
      .filter(([, u]) => u.count >= opts.minOccurrences)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 25);
    if (!candidates.length) continue;

    let sheet = m.sheets.find((s) => s.name === "Parameters");
    if (!sheet) {
      sheet = { name: "Parameters", visibility: "visible", rows: 2, cols: 5, cells: {}, merges: [] };
      const headers = ["Parameter", "Value", "Occurrences", "Used in (sample)", "Rule"];
      headers.forEach((h, c) => {
        const a = addrOf(0, c);
        sheet!.cells[a] = { a, r: 0, c, t: "s", v: h };
      });
      m.sheets.push(sheet);
      pushDiff(ctx, {
        sheet: "Parameters", cell: "A1", before: null, after: "Parameters sheet created", kind: "structure",
        ruleId: "T001", reason: "Created Parameters sheet for extracted constants",
        confidence: 1, riskDelta: "neutral",
      });
    }
    let startRow = 1;
    for (const k of Object.keys(sheet.cells)) startRow = Math.max(startRow, sheet.cells[k].r + 1);

    candidates.forEach(([literal, u], i) => {
      const name = `PARAM_${i + 1}`;
      const r = startRow + i;
      const write = (c: number, v: string | number) => {
        const a = addrOf(r, c);
        sheet!.cells[a] = { a, r, c, t: typeof v === "number" ? "n" : "s", v };
      };
      write(0, name);
      write(1, Number(literal));
      write(2, u.count);
      write(3, u.cells.slice(0, 3).join(", ") + (u.cells.length > 3 ? ", …" : ""));
      write(4, "T001");
      m.names = m.names.filter((n) => n.name !== name);
      m.names.push({ name, ref: `Parameters!$B$${r + 1}`, sheet: null, broken: false });

      // replace literals in formulas
      for (const sh of m.sheets) {
        if (sh.name === "Parameters") continue;
        for (const addr of Object.keys(sh.cells)) {
          const cell = sh.cells[addr];
          if (!cell.f || !cell.f.includes(literal)) continue;
          const nf = replaceNumberLiteral(cell.f, literal, name);
          if (nf !== cell.f) {
            pushDiff(ctx, {
              sheet: sh.name, cell: addr.toUpperCase(), before: `=${cell.f}`, after: `=${nf}`,
              kind: "formula", ruleId: "T001",
              reason: `Replaced repeated constant ${literal} with named parameter ${name}`,
              params: { literal, name }, confidence: 0.9, riskDelta: "down",
            });
            cell.f = nf;
          }
        }
      }
      sheet!.rows = Math.max(sheet!.rows, r + 1);
      sheet!.cols = 5;
    });
  }
}

const RULES: Record<string, (models: WorkbookModel[], ctx: Ctx, opts: TransformOptions) => void> = {
  T001: (m, c, o) => t001ExtractParams(m, c, { minOccurrences: o.minOccurrences ?? 3 }),
  T002: (m, c) => t002Normalize(m, c),
  T003: (m, c) => t003SnapshotExternal(m, c),
  T004: (m, c) => t004FreezeVolatile(m, c),
  T005: (m, c) => t005Unmerge(m, c),
  T006: (m, c) => t006RepairNames(m, c),
  T007: (m, c) => t007Trim(m, c),
  T008: (m, c) => t008Dedupe(m, c),
  T009: (m, c) => t009Unicode(m, c),
  T010: (m, c) => t010Dates(m, c),
  T011: (m, c) => t011GuardErrors(m, c),
  T013: (m, c) => t013Numbers(m, c),
};

/** Order matters: textual cleaning first, then structural, then formula rewrites. */
const EXECUTION_ORDER = ["T007", "T009", "T010", "T013", "T008", "T005", "T006", "T011", "T002", "T003", "T004", "T001"];

export interface TransformOptions {
  minOccurrences?: number;
}

export interface TransformResult {
  models: WorkbookModel[];
  diffs: Diff[];
  summary: TransformOutput["summary"];
}

/**
 * Apply the selected deterministic rules to deep clones of the given models.
 * The input is never mutated — previews are always reproducible from
 * (original model, toolIds, options).
 */
export function applyTransforms(
  input: WorkbookModel[],
  toolIds: string[],
  options: TransformOptions = {}
): TransformResult {
  const models = structuredClone(input);
  const ctx: Ctx = { diffs: [], byTool: {}, total: 0 };
  const order = EXECUTION_ORDER.filter((id) => toolIds.includes(id));
  for (const id of order) RULES[id]?.(models, ctx, options);
  const summary: TransformOutput["summary"] = {
    cellsChanged: ctx.diffs.filter((d) => d.kind === "value").length,
    formulasChanged: ctx.diffs.filter((d) => d.kind === "formula").length,
    rowsRemoved: ctx.diffs.filter((d) => d.kind === "row").length,
    namesFixed: ctx.diffs.filter((d) => d.kind === "name").length,
    mergesRemoved: ctx.byTool["T005"] ?? 0,
    sheetsAdded:
      ctx.diffs.some((d) => d.sheet === "SourceData") || ctx.diffs.some((d) => d.sheet === "Parameters" && d.before === null)
        ? [...new Set(ctx.diffs.filter((d) => d.before === null && (d.sheet === "SourceData" || d.sheet === "Parameters")).map((d) => d.sheet))]
        : [],
    byTool: ctx.byTool,
    riskScoreBefore: -1,
    riskScoreAfter: -1,
    risksResolved: 0,
  };
  return { models, diffs: ctx.diffs, summary };
}
