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

const MAX_ZIP_ENTRIES = 100_000;
const MAX_ZIP_ENTRY_BYTES = 256 * 1024 * 1024;
const MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const ZIP_RATIO_GUARD_BYTES = 32 * 1024 * 1024;
const MAX_ZIP_EXPANSION_RATIO = 100;

/**
 * Inspect ZIP central-directory metadata before decompression. This does not
 * replace parsing/model limits; it rejects obvious ZIP bombs and unsupported
 * ZIP64/multi-disk containers before a parser can allocate expanded contents.
 */
export function assertSafeZipContainer(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minEocdSize = 22;
  const searchStart = Math.max(0, bytes.byteLength - 65_557);
  let eocd = -1;
  for (let offset = bytes.byteLength - minEocdSize; offset >= searchStart; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("INVALID_ZIP_CONTAINER: XLSX file has no ZIP directory footer");

  const diskNumber = view.getUint16(eocd + 4, true);
  const directoryDisk = view.getUint16(eocd + 6, true);
  const entriesOnDisk = view.getUint16(eocd + 8, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (diskNumber !== 0 || directoryDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error("ZIP_CONTAINER_UNSUPPORTED: multi-disk ZIP workbooks are not supported");
  }
  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new Error("ZIP64_UNSUPPORTED: ZIP64 workbooks exceed the configured safe parsing limits");
  }
  if (entryCount > MAX_ZIP_ENTRIES || directoryOffset + directorySize > eocd || directoryOffset + directorySize > bytes.byteLength) {
    throw new Error("INVALID_ZIP_CONTAINER: invalid or oversized ZIP central directory");
  }

  let cursor = directoryOffset;
  const directoryEnd = directoryOffset + directorySize;
  let compressedTotal = 0;
  let uncompressedTotal = 0;
  for (let index = 0; index < entryCount; index++) {
    if (cursor + 46 > directoryEnd || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error("INVALID_ZIP_CONTAINER: malformed ZIP central directory entry");
    }
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const entryEnd = cursor + 46 + nameLength + extraLength + commentLength;
    if (entryEnd > directoryEnd) throw new Error("INVALID_ZIP_CONTAINER: ZIP entry exceeds central directory bounds");
    if (flags & 0x0001) throw new Error("ENCRYPTED_WORKBOOK_UNSUPPORTED: encrypted ZIP workbooks cannot be inspected");
    if (method !== 0 && method !== 8) throw new Error("ZIP_COMPRESSION_UNSUPPORTED: workbook uses an unsupported compression method");
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error("ZIP64_UNSUPPORTED: ZIP64 entries exceed the configured safe parsing limits");
    }
    if (uncompressedSize > MAX_ZIP_ENTRY_BYTES) {
      throw new Error("ZIP_BOMB_SUSPECTED: a workbook ZIP entry exceeds the safe expanded-size limit");
    }
    compressedTotal += compressedSize;
    uncompressedTotal += uncompressedSize;
    if (uncompressedTotal > MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error("ZIP_BOMB_SUSPECTED: workbook expanded contents exceed the safe size limit");
    }
    cursor = entryEnd;
  }
  if (cursor > directoryEnd) throw new Error("INVALID_ZIP_CONTAINER: ZIP directory bounds are inconsistent");
  const ratio = compressedTotal > 0 ? uncompressedTotal / compressedTotal : uncompressedTotal > 0 ? Infinity : 1;
  if (uncompressedTotal > ZIP_RATIO_GUARD_BYTES && ratio > MAX_ZIP_EXPANSION_RATIO) {
    throw new Error("ZIP_BOMB_SUSPECTED: workbook expansion ratio exceeds the safe limit");
  }
}

interface RawZipEntry { content?: unknown }
interface RawZipWorkbook {
  keys?: string[];
  files?: Record<string, RawZipEntry>;
}

function rawZipText(book: RawZipWorkbook, pathName: string): string {
  const entry = book.files?.[pathName] ?? book.files?.[`/${pathName}`];
  const content = entry?.content;
  if (typeof content === "string") return content;
  if (content instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(content));
  if (ArrayBuffer.isView(content)) {
    return new TextDecoder().decode(new Uint8Array(content.buffer, content.byteOffset, content.byteLength));
  }
  return "";
}

/**
 * The reduced workbook model cannot reconstruct these OOXML parts/elements.
 * Inspect the package itself so a workbook is not silently exported with
 * charts, validation rules, hyperlinks, connections, or other features removed.
 */
function detectUnsupportedPackageFeatures(wb: XLSX.WorkBook, model: WorkbookModel): void {
  const raw = wb as unknown as RawZipWorkbook;
  const paths = (raw.keys?.length ? raw.keys : Object.keys(raw.files ?? {})).map((p) => p.replace(/^\/+/, ""));
  if (!paths.length) {
    model.unsupportedFeatures = [...new Set([...(model.unsupportedFeatures ?? []), "OOXML package feature inspection unavailable"])];
    return;
  }

  const features = new Set(model.unsupportedFeatures ?? []);
  const partRules: Array<[RegExp, string]> = [
    [/^xl\/charts\//i, "charts"],
    [/^xl\/drawings\//i, "drawings and embedded images"],
    [/^xl\/pivotTables\//i, "pivot tables"],
    [/^xl\/pivotCache\//i, "pivot caches"],
    [/^xl\/externalLinks\//i, "external workbook link metadata"],
    [/^xl\/connections\.xml$/i, "external data connections"],
    [/^xl\/queryTables\//i, "query tables"],
    [/^xl\/tables\//i, "Excel tables"],
    [/^xl\/slicers?\//i, "slicers"],
    [/^xl\/activeX\//i, "ActiveX controls"],
    [/^xl\/embeddings\//i, "embedded objects"],
    [/^xl\/ctrlProps\//i, "form controls"],
    [/^xl\/threadedComments\//i, "threaded comments"],
    [/^xl\/comments\d*\.xml$/i, "cell comments"],
    [/^xl\/persons\//i, "comment authors"],
    [/^xl\/webExtensions\//i, "web extensions"],
    [/^customXml\//i, "custom XML"],
    [/^xl\/vbaProject\.bin$/i, "VBA macros"],
    [/^xl\/metadata\.xml$/i, "dynamic-array metadata"],
    [/^xl\/printerSettings\//i, "custom printer settings"],
  ];
  for (const pathName of paths) {
    for (const [pattern, feature] of partRules) {
      if (pattern.test(pathName)) features.add(feature);
    }
  }

  const worksheetTags: Array<[RegExp, string]> = [
    [/<(?:[A-Za-z0-9_]+:)?conditionalFormatting\b/i, "conditional formatting"],
    [/<(?:[A-Za-z0-9_]+:)?dataValidations\b/i, "data validation rules"],
    [/<(?:[A-Za-z0-9_]+:)?hyperlinks\b/i, "hyperlinks"],
    [/<(?:[A-Za-z0-9_]+:)?autoFilter\b/i, "auto-filters"],
    [/<(?:[A-Za-z0-9_]+:)?tableParts\b/i, "Excel tables"],
    [/<(?:[A-Za-z0-9_]+:)?drawing\b|<(?:[A-Za-z0-9_]+:)?legacyDrawing\b/i, "drawings and embedded images"],
    [/<(?:[A-Za-z0-9_]+:)?oleObjects\b/i, "embedded objects"],
    [/<(?:[A-Za-z0-9_]+:)?controls\b/i, "form controls"],
    [/<(?:[A-Za-z0-9_]+:)?sheetProtection\b/i, "worksheet protection"],
    [/<(?:[A-Za-z0-9_]+:)?extLst\b/i, "worksheet extension data"],
    [/<(?:[A-Za-z0-9_]+:)?pane\b/i, "frozen panes"],
  ];
  for (const pathName of paths) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/i.test(pathName)) continue;
    const xml = rawZipText(raw, pathName);
    for (const [pattern, feature] of worksheetTags) {
      if (pattern.test(xml)) features.add(feature);
    }
  }

  const workbookXml = rawZipText(raw, "xl/workbook.xml");
  if (/<(?:[A-Za-z0-9_]+:)?workbookProtection\b/i.test(workbookXml)) features.add("workbook protection");
  if (/<(?:[A-Za-z0-9_]+:)?extLst\b/i.test(workbookXml)) features.add("workbook extension data");

  if (features.size) model.unsupportedFeatures = [...features];
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
  // Local mode runs in the browser. SheetJS has already parsed cell styles and
  // dimensions, and the OOXML package scan above detects features we cannot
  // preserve. Do not load the Node-oriented ExcelJS enrichment module in a
  // browser bundle; doing so can fail on Node-only APIs and wrongly block export.
  if (typeof window !== "undefined") return;

  try {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    await workbook.xlsx.load(data, { ignoreNodes: ["definedNames"] });
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
  if (/\.(xlsx|xlsm|xlsb)$/i.test(fileName)) assertSafeZipContainer(bytes);
  const wb = XLSX.read(bytes, { type: "array", cellDates: true, cellNF: true, cellStyles: true, dense: false, bookFiles: true });
  const model = requireCompleteModel(workbookToModel(wb, fileId, fileName, "binary"));
  detectUnsupportedPackageFeatures(wb, model);
  // Drop raw decompressed ZIP entries before ExcelJS opens the workbook, so
  // package inspection does not double peak memory on large files.
  const rawPackage = wb as unknown as { keys?: string[]; files?: Record<string, unknown> };
  delete rawPackage.keys;
  delete rawPackage.files;
  await addStyleMetadata(model, bytes);
  return model;
}

/** Text entry-point used by browser local-mode (CSV/TSV/JSON strings). */
export function parseText(fileId: string, fileName: string, text: string): Promise<WorkbookModel> {
  const bytes = new TextEncoder().encode(text);
  return parseFile(fileId, fileName, bytes);
}
