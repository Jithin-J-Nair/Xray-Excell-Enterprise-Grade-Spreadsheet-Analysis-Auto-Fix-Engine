// ── Workbook ingestion: bytes/text → WorkbookModel (isomorphic) ──────────────
import * as XLSX from "@redoper1/xlsx-js-style";
import type { CellModel, NamedRangeModel, SheetModel, WorkbookModel } from "./types";

export const MAX_MODEL_CELLS = 60000;
/** Prevent dense exports from expanding pathological sparse worksheet ranges. */
export const MAX_MODEL_GRID_CELLS = 1_000_000;

const SPREADSHEET_EXT = /\.(xlsx|xlsm|xlsb|xls|csv|tsv|txt|json|ndjson)$/i;

export function isSupportedFile(name: string): boolean {
  return SPREADSHEET_EXT.test(name);
}

export function supportedExtensions(): string[] {
  return [".xlsx", ".xlsm", ".xlsb", ".xls", ".csv", ".tsv", ".json", ".ndjson"];
}

function decodeDelimited(bytes: Uint8Array, name: string): { text: string; encoding: string } {
  // UTF-8 BOM
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "UTF-8 (BOM)" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "UTF-8" };
  } catch {
    try {
      return { text: new TextDecoder("shift_jis").decode(bytes), encoding: "Shift_JIS" };
    } catch {
      return { text: new TextDecoder("utf-8").decode(bytes), encoding: "UTF-8 (lossy)" };
    }
  }
}

interface SheetMeta {
  Hidden: number;
}

function visibilityOf(meta?: SheetMeta): SheetModel["visibility"] {
  if (!meta) return "visible";
  if (meta.Hidden === 1) return "hidden";
  if (meta.Hidden === 2) return "veryHidden";
  return "visible";
}

/** Never allow a capped, partial workbook to masquerade as a complete analysis. */
function requireCompleteModel(model: WorkbookModel): WorkbookModel {
  model.macroEnabled = /\.xlsm$/i.test(model.fileName);
  if (model.truncated) {
    throw new Error(
      `MODEL_TRUNCATED: ${model.fileName} exceeds the configured workbook limits (${MAX_MODEL_CELLS.toLocaleString()} populated cells or ${MAX_MODEL_GRID_CELLS.toLocaleString()} total used-range grid cells). No partial workbook was returned; split the workbook or raise the limits after profiling.`
    );
  }
  return model;
}

function workbookToModel(wb: XLSX.WorkBook, fileId: string, fileName: string, encoding?: string): WorkbookModel {
  const model: WorkbookModel = { fileId, fileName, encoding, sheets: [], names: [] };
  let budget = MAX_MODEL_CELLS;
  let gridBudget = MAX_MODEL_GRID_CELLS;
  if (model.truncated === undefined) model.truncated = false;

  const sheetMetas = ((wb.Workbook?.Sheets as SheetMeta[] | undefined) ?? []) as SheetMeta[];

  for (let i = 0; i < wb.SheetNames.length; i++) {
    const name = wb.SheetNames[i];
    const ws = wb.Sheets[name];
    const sheet: SheetModel = {
      name,
      visibility: visibilityOf(sheetMetas[i]),
      rows: 0,
      cols: 0,
      cells: {},
      merges: [],
      columnWidths: (ws["!cols"] ?? []).map((col) => ({
        ...(typeof col.wch === "number" ? { wch: col.wch } : {}),
        ...(typeof col.wpx === "number" ? { wpx: col.wpx } : {}),
        ...(typeof col.hidden === "boolean" ? { hidden: col.hidden } : {}),
      })),
      rowHeights: (ws["!rows"] ?? []).map((row) => ({
        ...(typeof row.hpt === "number" ? { hpt: row.hpt } : {}),
        ...(typeof row.hpx === "number" ? { hpx: row.hpx } : {}),
        ...(typeof row.hidden === "boolean" ? { hidden: row.hidden } : {}),
      })),
    };
    const ref = ws["!ref"];
    if (ref) {
      const range = XLSX.utils.decode_range(ref);
      sheet.rows = range.e.r + 1;
      sheet.cols = range.e.c + 1;
    }

    // The populated-cell cap alone does not protect dense exporters: one cell
    // at XFD1048576 can imply a ~17-billion-cell rectangle. Bound the total
    // logical used-range area before exposing this model to CSV/JSON exporters.
    const gridCells = sheet.rows * sheet.cols;
    if (!Number.isSafeInteger(gridCells) || gridCells > gridBudget) {
      model.truncated = true;
      break;
    }
    gridBudget -= gridCells;

    for (const m of ws["!merges"] ?? []) {
      sheet.merges.push({ r1: m.s.r, c1: m.s.c, r2: m.e.r, c2: m.e.c });
    }
    for (const key of Object.keys(ws)) {
      if (key[0] === "!") continue;
      if (budget <= 0) {
        model.truncated = true;
        break;
      }
      const cell = ws[key] as XLSX.CellObject;
      if (!cell || cell.t === undefined) continue;
      // Blank string placeholders carry no value. Skip them unless they have
      // formulas/styles/number formats; this keeps logically empty sheets empty.
      if (
        cell.t === "s" &&
        (cell.v === "" || cell.v === null || cell.v === undefined) &&
        cell.f == null &&
        !cell.s &&
        typeof cell.z !== "string"
      ) continue;
      let parsed: { r: number; c: number };
      try {
        parsed = XLSX.utils.decode_cell(key);
      } catch {
        continue;
      }
      let t: CellModel["t"] = "z";
      let v: CellModel["v"] = null;
      if (cell.t === "n") {
        t = "n";
        v = typeof cell.v === "number" ? cell.v : Number(cell.v) || 0;
      } else if (cell.t === "s") {
        t = "s";
        v = String(cell.v ?? "");
      } else if (cell.t === "b") {
        t = "b";
        v = Boolean(cell.v);
      } else if (cell.t === "e") {
        t = "e";
        v = String(cell.v ?? "#ERROR!");
      } else if (cell.t === "d") {
        t = "d";
        const d = cell.v instanceof Date ? cell.v : new Date(String(cell.v));
        v = isNaN(d.getTime()) ? String(cell.v ?? "") : d.toISOString();
      } else if (cell.v !== undefined && typeof cell.v === "string") {
        // formula string result or untyped text
        t = "s";
        v = cell.v;
      } else if (cell.f !== undefined && cell.f !== null) {
        // formula without a cached value (common in tool-generated files)
        t = "s";
        v = null;
      } else {
        continue; // stubs / blanks skipped
      }
      const c: CellModel = { a: XLSX.utils.encode_cell(parsed), r: parsed.r, c: parsed.c, t, v };
      if (cell.f !== undefined && cell.f !== null) {
        c.f = String(cell.f).replace(/^=/, "");
      }
      if (typeof cell.z === "string") c.z = cell.z;
      if (cell.s && typeof cell.s === "object") c.s = cell.s as Record<string, unknown>;
      sheet.cells[c.a] = c;
      budget--;
      if (parsed.r + 1 > sheet.rows) sheet.rows = parsed.r + 1;
      if (parsed.c + 1 > sheet.cols) sheet.cols = parsed.c + 1;
    }
    sheet.rows = Math.max(sheet.rows, 1);
    sheet.cols = Math.max(sheet.cols, 1);
    model.sheets.push(sheet);
  }

  const names = (wb.Workbook?.Names ?? []) as { Name: string; Ref?: string; Sheet?: number }[];
  for (const n of names) {
    const ref = String(n.Ref ?? "");
    const scoped =
      typeof n.Sheet === "number" && wb.SheetNames[n.Sheet] ? wb.SheetNames[n.Sheet] : null;
    const nr: NamedRangeModel = {
      name: n.Name,
      ref,
      sheet: scoped,
      broken: /#REF!/.test(ref),
    };
    model.names.push(nr);
  }
  return model;
}

function jsonToWorkbook(text: string, name: string): XLSX.WorkBook {
  const lines = name.toLowerCase().endsWith(".ndjson")
    ? text.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l))
    : JSON.parse(text);
  const rows: unknown[] = Array.isArray(lines) ? lines : [lines];
  const allObjects = rows.every((r) => r && typeof r === "object" && !Array.isArray(r));
  const wb = XLSX.utils.book_new();
  let aoa: unknown[][];
  if (allObjects) {
    const keys: string[] = [];
    for (const r of rows as Record<string, unknown>[]) {
      for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
    }
    aoa = [keys, ...(rows as Record<string, unknown>[]).map((r) => keys.map((k) => r[k] ?? null))];
  } else {
    aoa = rows.map((r) => (Array.isArray(r) ? r : [r])) as unknown[][];
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, "data");
  return wb;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeColor(value: unknown): unknown {
  const color = record(value);
  if (typeof color.argb === "string") return { rgb: color.argb.slice(-6) };
  return value;
}

/** Convert ExcelJS style objects into the style shape written by xlsx-js-style. */
function normalizeCellStyle(value: unknown): Record<string, unknown> {
  const source = record(value);
  const output: Record<string, unknown> = {};
  const font = record(source.font);
  if (Object.keys(font).length) {
    const normalized = { ...font };
    if (typeof font.size === "number") normalized.sz = font.size;
    delete normalized.size;
    if (font.color) normalized.color = normalizeColor(font.color);
    output.font = normalized;
  }
  const fill = record(source.fill);
  if (Object.keys(fill).length) {
    const normalized = { ...fill };
    if (typeof fill.pattern === "string") normalized.patternType = fill.pattern;
    delete normalized.type;
    delete normalized.pattern;
    if (fill.fgColor) normalized.fgColor = normalizeColor(fill.fgColor);
    if (fill.bgColor) normalized.bgColor = normalizeColor(fill.bgColor);
    output.fill = normalized;
  }
  const border = record(source.border);
  if (Object.keys(border).length) {
    const normalized: Record<string, unknown> = {};
    for (const [sideName, sideValue] of Object.entries(border)) {
      const side = record(sideValue);
      normalized[sideName] = side.color
        ? { ...side, color: normalizeColor(side.color) }
        : sideValue;
    }
    output.border = normalized;
  }
  const alignment = record(source.alignment);
  if (Object.keys(alignment).length) {
    const normalized = { ...alignment };
    if (normalized.vertical === "middle") normalized.vertical = "center";
    output.alignment = normalized;
  }
  return output;
}

/** Enrich SheetJS cell data with styles/dimensions from ExcelJS. */
async function addStyleMetadata(model: WorkbookModel, bytes: Uint8Array): Promise<void> {
  if (!/\.xlsx$/i.test(model.fileName)) {
    // The ExcelJS enrichment path is only enabled for OOXML .xlsx files.
    // Legacy .xls/.xlsb styles are therefore not represented in this model;
    // block reconstruction rather than silently exporting an unformatted copy.
    if (/\.(xls|xlsb)$/i.test(model.fileName)) {
      model.styleMetadataUnavailable = true;
    }
    return;
  }
  try {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    // ExcelJS expects a Node Buffer in its Node reader path. Passing a bare
    // ArrayBuffer can fail on otherwise valid workbooks, falsely marking all
    // style metadata unavailable and blocking exports. Keep browser parsing
    // isomorphic by falling back to the original Uint8Array when Buffer is absent.
    const excelData = typeof Buffer !== "undefined" ? Buffer.from(bytes) : bytes;
    await workbook.xlsx.load(excelData as never);
    for (const sheetModel of model.sheets) {
      const source = workbook.getWorksheet(sheetModel.name);
      if (!source) continue;

      // This serializer rebuilds worksheets from the reduced model and cannot
      // write conditional-formatting rules. Detect them and fail closed rather
      // than silently stripping business-critical visual rules from the export.
      const conditionalFormattings =
        (source as unknown as { conditionalFormattings?: unknown[] }).conditionalFormattings;
      if (conditionalFormattings?.length) {
        model.unsupportedFeatures = [
          ...new Set([...(model.unsupportedFeatures ?? []), "conditional formatting"]),
        ];
      }

      source.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          const target = sheetModel.cells[cell.address];
          if (!target) return;
          const style = normalizeCellStyle(cell.style);
          if (Object.keys(style).length) target.s = style;
          if (typeof cell.numFmt === "string") target.z = cell.numFmt;
        });
      });
      const widths: { wch?: number; hidden?: boolean }[] = [];
      source.columns.forEach((column, index) => {
        const item: { wch?: number; hidden?: boolean } = {};
        // SheetJS wch is the Excel character width before its XML padding; ExcelJS
        // reports the serialized width including the ~0.832 character padding.
        if (column.isCustomWidth && typeof column.width === "number") item.wch = Math.max(0, column.width - 0.83203125);
        if (column.hidden) item.hidden = true;
        widths[index] = item;
      });
      if (widths.some((item) => item.wch !== undefined || item.hidden !== undefined)) sheetModel.columnWidths = widths;
      const heights: { hpt?: number; hidden?: boolean }[] = [];
      source.eachRow({ includeEmpty: true }, (row) => {
        const item: { hpt?: number; hidden?: boolean } = {};
        if (typeof row.height === "number") item.hpt = row.height;
        if (row.hidden) item.hidden = true;
        heights[row.number - 1] = item;
      });
      if (heights.length) sheetModel.rowHeights = heights;
    }
  } catch (error) {
    // SheetJS remains the compatibility parser for unusual Excel files.
    // If ExcelJS cannot read a workbook, value/formula parsing still works;
    // unsupported style metadata is not fabricated.
    model.styleMetadataUnavailable = true;
    console.warn("xlsx-style-metadata-unavailable", model.fileName, error);
  }
}

/** Parse raw file bytes into a normalized WorkbookModel. */
export async function parseFile(fileId: string, fileName: string, bytes: Uint8Array): Promise<WorkbookModel> {
  const lower = fileName.toLowerCase();
  if (!isSupportedFile(fileName)) {
    throw new Error(`UNSUPPORTED_FORMAT: ${fileName}`);
  }
  if (lower.endsWith(".json") || lower.endsWith(".ndjson")) {
    const text = new TextDecoder("utf-8").decode(bytes);
    const wb = jsonToWorkbook(text, lower);
    return requireCompleteModel(workbookToModel(wb, fileId, fileName, "UTF-8"));
  }
  if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) {
    const { text, encoding } = decodeDelimited(bytes, lower);
    const wb = XLSX.read(text, { type: "string", cellDates: true, cellStyles: true });
    return requireCompleteModel(workbookToModel(wb, fileId, fileName, encoding));
  }
  const wb = XLSX.read(bytes, { type: "array", cellDates: true, cellNF: true, cellStyles: true, dense: false });
  const model = requireCompleteModel(workbookToModel(wb, fileId, fileName, "binary"));
  await addStyleMetadata(model, bytes);
  return model;
}

/** Text entry-point used by browser local-mode (CSV/TSV/JSON strings). */
export function parseText(fileId: string, fileName: string, text: string): Promise<WorkbookModel> {
  const bytes = new TextEncoder().encode(text);
  return parseFile(fileId, fileName, bytes);
}
