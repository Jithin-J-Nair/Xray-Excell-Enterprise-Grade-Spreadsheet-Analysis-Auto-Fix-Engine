// ── Workbook ingestion: bytes/text → WorkbookModel (isomorphic) ──────────────
import * as XLSX from "xlsx";
import type { CellModel, NamedRangeModel, SheetModel, WorkbookModel } from "./types";

export const MAX_MODEL_CELLS = 60000;

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
  if (model.truncated) {
    throw new Error(
      `MODEL_TRUNCATED: ${model.fileName} exceeds the ${MAX_MODEL_CELLS.toLocaleString()}-cell analysis limit. No partial workbook was returned; split the workbook or raise the configured limit after profiling.`
    );
  }
  return model;
}

function workbookToModel(wb: XLSX.WorkBook, fileId: string, fileName: string, encoding?: string): WorkbookModel {
  const model: WorkbookModel = { fileId, fileName, encoding, sheets: [], names: [] };
  let budget = MAX_MODEL_CELLS;
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

/** Parse raw file bytes into a normalized WorkbookModel. */
export function parseFile(fileId: string, fileName: string, bytes: Uint8Array): WorkbookModel {
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
  return requireCompleteModel(workbookToModel(wb, fileId, fileName, "binary"));
}

/** Text entry-point used by browser local-mode (CSV/TSV/JSON strings). */
export function parseText(fileId: string, fileName: string, text: string): WorkbookModel {
  const bytes = new TextEncoder().encode(text);
  return parseFile(fileId, fileName, bytes);
}
