// ── Export serializers: XLSX / CSV(+BOM) / JSON / NDJSON / MD (isomorphic) ──
import * as XLSX from "xlsx-js-style";
import type { AnalysisResult, CellModel, SheetModel, WorkbookModel } from "./types";
import { addrOf } from "./formula";

function assertCompleteModel(model: WorkbookModel): void {
  if (model.truncated) {
    throw new Error(`MODEL_TRUNCATED: refusing to export incomplete workbook ${model.fileName}`);
  }
}

function sanitizeSheetName(raw: string, used: Set<string>): string {
  let name = raw.replace(/[\\/?*\[\]:]/g, " ").slice(0, 31).trim() || "Sheet";
  let base = name;
  let i = 1;
  while (used.has(name.toLowerCase())) {
    name = `${base.slice(0, 28)}_${i++}`;
  }
  used.add(name.toLowerCase());
  return name;
}

/** Rebuild a real XLSX workbook (formulas, merges, defined names) from a model. */
export function modelToWorkbook(model: WorkbookModel): XLSX.WorkBook {
  assertCompleteModel(model);
  if (model.macroEnabled) {
    throw new Error("MACROS_UNSUPPORTED: exporting this macro-enabled workbook as .xlsx would discard VBA; export a non-macro copy or use a macro-preserving workflow.");
  }
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const sheet of model.sheets) {
    const ws: XLSX.WorkSheet = {};
    let maxR = 0;
    let maxC = 0;
    for (const key of Object.keys(sheet.cells)) {
      const cell = sheet.cells[key];
      const out: XLSX.CellObject = { t: "s", v: "" };
      if (cell.t === "n") {
        out.t = "n";
        out.v = typeof cell.v === "number" ? cell.v : Number(cell.v) || 0;
      } else if (cell.t === "b") {
        out.t = "b";
        out.v = Boolean(cell.v);
      } else if (cell.t === "d") {
        out.t = "d";
        const d = new Date(String(cell.v));
        if (isNaN(d.getTime())) {
          out.t = "s";
          out.v = String(cell.v ?? "");
        } else out.v = d;
      } else if (cell.t === "e") {
        out.t = "e";
        out.v = String(cell.v ?? "#N/A");
      } else {
        out.t = "s";
        out.v = String(cell.v ?? "");
      }
      if (cell.z) out.z = cell.z;
      if (cell.s) (out as XLSX.CellObject & { s?: Record<string, unknown> }).s = cell.s;
      if (cell.f) {
        out.f = cell.f;
        if (cell.v === null || cell.v === undefined) {
          // SheetJS drops cells that have no value at all — an empty cached
          // string keeps the formula alive; Excel recalculates it on open.
          out.v = "";
        }
      }
      ws[cell.a] = out;
      maxR = Math.max(maxR, cell.r);
      maxC = Math.max(maxC, cell.c);
    }
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
    if (sheet.columnWidths?.length) ws["!cols"] = sheet.columnWidths as XLSX.ColInfo[];
    if (sheet.rowHeights?.length) ws["!rows"] = sheet.rowHeights as XLSX.RowInfo[];
    if (sheet.merges.length) {
      ws["!merges"] = sheet.merges.map((m) => ({
        s: { r: m.r1, c: m.c1 },
        e: { r: m.r2, c: m.c2 },
      }));
    }
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(sheet.name, used));
  }
  const names = (model.names ?? []).filter((n) => !n.broken && n.ref);
  wb.Workbook = {
    Sheets: model.sheets.map((s) => ({
      Hidden: s.visibility === "hidden" ? 1 : s.visibility === "veryHidden" ? 2 : 0,
    })),
    Names: names.map((n) => ({ Name: n.name, Ref: n.ref })),
  };
  return wb;
}

export function workbookToXlsxBytes(model: WorkbookModel): Uint8Array {
  const wb = modelToWorkbook(model);
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true }) as Uint8Array | ArrayBuffer;
  return out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer);
}

function sheetBounds(sheet: SheetModel): { rows: number; cols: number } {
  let rows = sheet.rows;
  let cols = sheet.cols;
  for (const k of Object.keys(sheet.cells)) {
    const cell = sheet.cells[k];
    if (cell.r + 1 > rows) rows = cell.r + 1;
    if (cell.c + 1 > cols) cols = cell.c + 1;
  }
  return { rows: Math.max(rows, 1), cols: Math.max(cols, 1) };
}

function displayValue(cell: CellModel | undefined): string | number | boolean | null {
  if (!cell) return null;
  if (cell.v !== null && cell.v !== undefined) {
    if (cell.t === "d") return String(cell.v).slice(0, 10);
    return cell.v as string | number | boolean;
  }
  if (cell.f) return `=${cell.f}`;
  return null;
}

/** Rows as plain matrix for a sheet. */
export function sheetMatrix(sheet: SheetModel): (string | number | boolean | null)[][] {
  const { rows, cols } = sheetBounds(sheet);
  const out: (string | number | boolean | null)[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: (string | number | boolean | null)[] = [];
    for (let c = 0; c < cols; c++) row.push(displayValue(sheet.cells[addrOf(r, c)]));
    out.push(row);
  }
  return out;
}

function csvCell(v: string | number | boolean | null): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV with UTF-8 BOM prepended (Excel-compatible). */
export function sheetToCsv(sheet: SheetModel): string {
  const matrix = sheetMatrix(sheet);
  const body = matrix.map((row) => row.map(csvCell).join(",")).join("\r\n");
  return "﻿" + body + "\r\n";
  // (BOM char U+FEFF is prepended above — keeps Excel UTF-8 compatible)

}

function detectHeader(matrix: (string | number | boolean | null)[][]): boolean {
  if (matrix.length < 2) return false;
  const head = matrix[0];
  const next = matrix.slice(1, 4);
  return (
    head.every((v) => typeof v === "string" && v.trim() !== "") &&
    next.some((row) => row.some((v, i) => v !== null && typeof v !== typeof head[i]))
  );
}

/** JSON export of one or all sheets (header-aware objects). */
export function modelToJson(model: WorkbookModel, sheetName?: string, pretty = true): string {
  assertCompleteModel(model);
  const sheets = sheetName ? model.sheets.filter((s) => s.name === sheetName) : model.sheets;
  const toRows = (sheet: SheetModel) => {
    const matrix = sheetMatrix(sheet);
    if (detectHeader(matrix)) {
      const headers = matrix[0].map((h) => String(h));
      return matrix.slice(1).map((row) => {
        const obj: Record<string, unknown> = {};
        headers.forEach((h, i) => {
          obj[h] = row[i];
        });
        return obj;
      });
    }
    return matrix;
  };
  const payload =
    sheets.length === 1
      ? { sheet: sheets[0].name, rows: toRows(sheets[0]) }
      : sheets.map((s) => ({ sheet: s.name, rows: toRows(s) }));
  return JSON.stringify(payload, null, pretty ? 2 : 0);
}

export function modelToNdjson(model: WorkbookModel, sheetName?: string): string {
  assertCompleteModel(model);
  const sheets = sheetName ? model.sheets.filter((s) => s.name === sheetName) : model.sheets;
  const lines: string[] = [];
  for (const sheet of sheets) {
    const matrix = sheetMatrix(sheet);
    const hasHeader = detectHeader(matrix);
    const headers = hasHeader ? matrix[0].map((h) => String(h)) : matrix[0].map((_, i) => `C${i + 1}`);
    const data = hasHeader ? matrix.slice(1) : matrix;
    data.forEach((row, i) => {
      const obj: Record<string, unknown> = { __sheet: sheet.name, __row: i + (hasHeader ? 2 : 1) };
      headers.forEach((h, j) => (obj[h] = row[j]));
      lines.push(JSON.stringify(obj));
    });
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}

// ── Markdown report ──────────────────────────────────────────────────────────

function esc(v: unknown): string {
  return String(v ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export interface ReportContext {
  analysis: AnalysisResult;
  toolsApplied?: { id: string; name: string }[];
  summary?: Record<string, unknown>;
  audits?: { action: string; at: string; detail?: string }[];
  language?: "en" | "jp";
}

export function buildMarkdownReport(ctx: ReportContext): string {
  const { analysis } = ctx;
  const jp = (ctx.language ?? analysis.language) === "jp";
  const L = (en: string, ja: string) => (jp ? ja : en);
  const m = analysis.metrics;
  const lines: string[] = [];
  lines.push(`# X-RAY://EXCEL — ${L("Analysis Report", "分析レポート")}`);
  lines.push("");
  lines.push(`- ${L("Workbook", "対象")}: \`${esc(analysis.name)}\``);
  lines.push(`- ${L("Generated", "生成日時")}: ${new Date().toISOString()}`);
  lines.push(`- ${L("Data Health Score", "データヘルススコア")}: **${m.healthScore} / 100** (${L("risk score", "リスクスコア")} ${m.riskScore})`);
  lines.push("");
  lines.push(`## ${L("Summary", "サマリー")}`);
  lines.push("");
  lines.push(`| ${L("Metric", "指標")} | ${L("Value", "値")} |`);
  lines.push("|---|---|");
  const rows: [string, string | number][] = [
    [L("Files", "ファイル数"), m.files],
    [L("Sheets", "シート数"), m.sheets],
    [L("Cells", "セル数"), m.cells],
    [L("Formulas", "数式"), m.formulas],
    [L("Volatile functions", "揮発性関数"), m.volatile],
    [L("Circular references", "循環参照"), m.circular],
    [L("External links", "外部リンク"), m.externalLinks],
    [L("Merged ranges", "結合セル"), m.merged],
    [L("Hidden sheets", "非表示シート"), m.hiddenSheets],
    [L("Hard-coded literals", "ハードコード定数"), m.hardcoded],
    [L("Duplicate rows", "重複行"), m.duplicateRows],
    [L("Error cells", "エラーセル"), m.errorCells],
  ];
  for (const [k, v] of rows) lines.push(`| ${esc(k)} | ${v} |`);
  lines.push("");
  lines.push(`## ${L("Top Risks", "主要リスク")}`);
  lines.push("");
  const order = { critical: 0, error: 1, warning: 2, info: 3 } as const;
  const top = [...analysis.risks].sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 25);
  lines.push(`| ${L("ID", "ID")} | ${L("Severity", "重要度")} | ${L("Location", "場所")} | ${L("Issue", "内容")} |`);
  lines.push("|---|---|---|---|");
  for (const r of top) {
    const loc = [r.sheet, r.cell].filter(Boolean).join("!") || "-";
    lines.push(`| ${r.id} | ${r.severity} | ${esc(loc)} | ${esc(r.message)} |`);
  }
  lines.push("");
  if (analysis.volatileList.length) {
    lines.push(`## ${L("Dependency Snapshot", "依存関係スナップショット")}`);
    lines.push("");
    lines.push(
      L(
        `The dependency graph contains **${analysis.graph.nodes.length} nodes** and **${analysis.graph.edges.length} edges**${analysis.graph.truncated ? " (truncated for display)" : ""}.`,
        `依存グラフは **ノード ${analysis.graph.nodes.length} 件**、**エッジ ${analysis.graph.edges.length} 件**${analysis.graph.truncated ? "（表示用に一部省略）" : ""}。`
      )
    );
    lines.push("");
  }
  lines.push(`## ${L("Risk Register", "リスク一覧")}`);
  lines.push("");
  for (const [type, count] of Object.entries(analysis.riskCounts)) {
    lines.push(`- **${type}** — ${count}`);
  }
  lines.push("");
  lines.push(`## ${L("Suggested Fixes", "推奨される修正")}`);
  lines.push("");
  if (ctx.toolsApplied?.length) {
    for (const t of ctx.toolsApplied) lines.push(`- \`${t.id}\` ${esc(t.name)}`);
  } else {
    lines.push(L("Run Auto-Fix (Organize + Clean + Mitigate) from the Tools panel and review the preview before applying.", "ツールパネルで自動修正（整理＋クリーニング＋リスク低減）を実行し、プレビュー確認後に適用してください。"));
  }
  if (ctx.summary && Object.keys(ctx.summary).length) {
    lines.push("");
    lines.push(`### ${L("Applied change summary", "適用された変更サマリー")}`);
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(ctx.summary, null, 2).slice(0, 4000));
    lines.push("```");
  }
  if (ctx.audits?.length) {
    lines.push("");
    lines.push(`## ${L("Audit Trail", "監査ログ")}`);
    lines.push("");
    for (const a of ctx.audits) lines.push(`- \`${a.at}\` — **${a.action}** ${a.detail ? esc(a.detail) : ""}`);
  }
  lines.push("");
  lines.push("---");
  lines.push(
    L(
      "Generated deterministically by X-RAY://EXCEL v2. Every change is reversible — see the undo endpoint and patch files.",
      "X-RAY://EXCEL v2 によって決定論的に生成されました。すべての変更は取り消し可能です（undo エンドポイント／パッチファイル参照）。"
    )
  );
  return lines.join("\n");
}
