import * as XLSX from "@redoper1/xlsx-js-style";
import type { WorkbookModel } from "../types";
import { assertSafeZipContainer, parseFile } from "../parse";
import { workbookToXlsxBytes } from "../serialize";

export interface VerificationIssue { code: string; message: string; sheet?: string; cell?: string }
export interface PackagePartVerificationReport { ok: boolean; checkedParts: number; missingParts: string[]; error?: string }
const PROTECTED_PART = /^(?:_xmlsignatures\/|xl\/(?:charts\/|drawings\/|media\/|pivotTables\/|pivotCache\/|externalLinks\/|connections\.xml$|queryTables\/|tables\/|slicers?\/|slicerCaches\/|activeX\/|embeddings\/|ctrlProps\/|threadedComments\/|comments\d*\.xml$|persons\/|webExtensions\/|vbaProject(?:Signature)?\.bin$|printerSettings\/)|customXml\/)/i;
/** Checks that OOXML package parts carrying advanced features are still present after a native engine save. */
export function verifyProtectedPackageParts(sourceBytes: Uint8Array, outputBytes: Uint8Array): PackagePartVerificationReport {
  const readParts = (bytes: Uint8Array): Set<string> => {
    const workbook = XLSX.read(bytes, { type: "array", bookFiles: true }) as unknown as { keys?: string[]; files?: Record<string, unknown> };
    const parts = new Set((workbook.keys?.length ? workbook.keys : Object.keys(workbook.files ?? {})).map(name => name.replace(/^\/+/, "")));
    delete workbook.keys;
    delete workbook.files;
    return parts;
  };
  try {
    const source = readParts(sourceBytes), output = readParts(outputBytes);
    const required = [...source].filter(name => PROTECTED_PART.test(name));
    const missingParts = required.filter(name => !output.has(name)).sort();
    return { ok: missingParts.length === 0, checkedParts: required.length, missingParts };
  } catch (error) {
    return { ok: false, checkedParts: 0, missingParts: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export interface RecalculationVerificationReport {
  ok: boolean;
  engine: "recalculation-structure-comparison";
  issues: VerificationIssue[];
  originalFormulaCount: number;
  recalculatedFormulaCount: number;
}
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    return "{" + Object.keys(objectValue).sort().map(key => JSON.stringify(key) + ":" + stable(objectValue[key])).join(",") + "}";
  }
  return JSON.stringify(value) ?? String(value);
};
/**
 * Compare an engine output against the source model. Formula cached results may change, but
 * formula locations, formulas, literal cells, styles, number formats, merges, names and feature
 * markers must remain stable. This does not prove that formula results are Excel-equivalent.
 */
export function verifyRecalculatedWorkbook(before: WorkbookModel, after: WorkbookModel): RecalculationVerificationReport {
  const issues: VerificationIssue[] = [];
  const formulaEntries = (model: WorkbookModel) => model.sheets.flatMap(sheet =>
    Object.values(sheet.cells).filter(cell => !!cell.f).map(cell => ({ key: sheet.name + "!" + cell.a, formula: cell.f! }))
  ).sort((a, b) => a.key.localeCompare(b.key));
  const beforeFormulas = formulaEntries(before), afterFormulas = formulaEntries(after);
  if (before.sheets.length !== after.sheets.length) issues.push({ code: "SHEET_COUNT_MISMATCH", message: "Worksheet count changed during recalculation." });
  const maxSheets = Math.max(before.sheets.length, after.sheets.length);
  for (let index = 0; index < maxSheets; index++) {
    const source = before.sheets[index], output = after.sheets[index];
    if (!source || !output) continue;
    if (source.name !== output.name) issues.push({ code: "SHEET_NAME_MISMATCH", message: "Worksheet order or name changed.", sheet: source.name });
    if (source.visibility !== output.visibility) issues.push({ code: "SHEET_VISIBILITY_MISMATCH", message: "Worksheet visibility changed.", sheet: source.name });
    if (source.rows !== output.rows || source.cols !== output.cols) issues.push({ code: "SHEET_DIMENSION_MISMATCH", message: "Worksheet used dimensions changed.", sheet: source.name });
    for (let column = 0; column < (source.columnWidths?.length ?? 0); column++) {
      const expected = source.columnWidths?.[column], actual = output.columnWidths?.[column];
      if (!expected) continue;
      if (expected.hidden !== undefined && expected.hidden !== actual?.hidden) issues.push({ code: "COLUMN_VISIBILITY_MISMATCH", message: "Explicit column hidden state changed.", sheet: source.name, cell: String(column + 1) });
      const expectedWidth = expected.wch ?? (expected.wpx === undefined ? undefined : expected.wpx / 7);
      const actualWidth = actual?.wch ?? (actual?.wpx === undefined ? undefined : actual.wpx / 7);
      if (expectedWidth !== undefined && (actualWidth === undefined || Math.abs(expectedWidth - actualWidth) > 1.5)) issues.push({ code: "COLUMN_WIDTH_MISMATCH", message: "Explicit column width changed.", sheet: source.name, cell: String(column + 1) });
    }
    for (let row = 0; row < (source.rowHeights?.length ?? 0); row++) {
      const expected = source.rowHeights?.[row], actual = output.rowHeights?.[row];
      if (!expected) continue;
      if (expected.hidden !== undefined && expected.hidden !== actual?.hidden) issues.push({ code: "ROW_VISIBILITY_MISMATCH", message: "Explicit row hidden state changed.", sheet: source.name, cell: String(row + 1) });
      const expectedHeight = expected.hpt ?? (expected.hpx === undefined ? undefined : expected.hpx * 0.75);
      const actualHeight = actual?.hpt ?? (actual?.hpx === undefined ? undefined : actual.hpx * 0.75);
      if (expectedHeight !== undefined && (actualHeight === undefined || Math.abs(expectedHeight - actualHeight) > 1.0)) issues.push({ code: "ROW_HEIGHT_MISMATCH", message: "Explicit row height changed.", sheet: source.name, cell: String(row + 1) });
    }
    const mergeKey = (m: { r1: number; c1: number; r2: number; c2: number }) => [m.r1, m.c1, m.r2, m.c2].join(":");
    if (stable(source.merges.map(mergeKey).sort()) !== stable(output.merges.map(mergeKey).sort())) issues.push({ code: "MERGE_MISMATCH", message: "Merged ranges changed during recalculation.", sheet: source.name });
    for (const cell of Object.values(source.cells)) {
      const actual = output.cells[cell.a];
      if (!actual) { issues.push({ code: "CELL_MISSING", message: "Cell disappeared during recalculation.", sheet: source.name, cell: cell.a }); continue; }
      if (cell.f) {
        if (actual.f !== cell.f) issues.push({ code: "FORMULA_CHANGED", message: "Formula text changed during recalculation.", sheet: source.name, cell: cell.a });
      } else if (cell.t !== actual.t || stable(cell.v) !== stable(actual.v)) {
        issues.push({ code: "CELL_CONTENT_MISMATCH", message: "A non-formula cell value or type changed during recalculation.", sheet: source.name, cell: cell.a });
      }
      if (cell.s && stable(cell.s) !== stable(actual.s ?? null)) issues.push({ code: "STYLE_MISMATCH", message: "Explicit cell style changed during recalculation.", sheet: source.name, cell: cell.a });
      if (cell.z && cell.z.toLowerCase() !== "general" && cell.z !== actual.z) issues.push({ code: "NUMBER_FORMAT_MISMATCH", message: "Explicit number format changed during recalculation.", sheet: source.name, cell: cell.a });
    }
  }
  if (stable(beforeFormulas.map(item => item.key)) !== stable(afterFormulas.map(item => item.key))) issues.push({ code: "FORMULA_LOCATION_MISMATCH", message: "Formula locations changed during recalculation." });
  const changedFormula = beforeFormulas.find(item => afterFormulas.find(candidate => candidate.key === item.key)?.formula !== item.formula);
  if (changedFormula && !issues.some(issue => issue.code === "FORMULA_CHANGED" && issue.cell === changedFormula.key.split("!").pop())) {
    issues.push({ code: "FORMULA_CHANGED", message: "Formula text changed during recalculation.", cell: changedFormula.key });
  }
  const names = (model: WorkbookModel) => (model.names ?? []).filter(name => !name.broken).map(name => [name.name, name.ref, name.sheet ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  if (stable(names(before)) !== stable(names(after))) issues.push({ code: "DEFINED_NAMES_MISMATCH", message: "Defined names changed during recalculation." });
  if (stable([...(before.unsupportedFeatures ?? [])].sort()) !== stable([...(after.unsupportedFeatures ?? [])].sort())) issues.push({ code: "FEATURE_MARKERS_CHANGED", message: "Unsupported OOXML feature markers changed during recalculation." });
  return { ok: issues.length === 0, engine: "recalculation-structure-comparison", issues, originalFormulaCount: beforeFormulas.length, recalculatedFormulaCount: afterFormulas.length };
}

export interface VerificationReport {
  ok: boolean; engine: "local-parser-roundtrip"; checkedAt: string; bytes: number;
  originalSheets: number; reopenedSheets: number; originalFormulaCount: number; reopenedFormulaCount: number;
  issues: VerificationIssue[];
}
const cells = (model: WorkbookModel) => model.sheets.reduce((n, s) => n + Object.keys(s.cells).length, 0);
const formulas = (model: WorkbookModel) => model.sheets.reduce((n, s) => n + Object.values(s.cells).filter(c => !!c.f).length, 0);
/** Serialize and reopen locally; fails closed when the reduced model cannot preserve known OOXML features. */
export async function verifyWorkbookExport(model: WorkbookModel, exportedBytes?: Uint8Array): Promise<VerificationReport> {
  const issues: VerificationIssue[] = [];
  let bytes: Uint8Array;
  try { bytes = exportedBytes ?? workbookToXlsxBytes(model); }
  catch (error) {
    return { ok: false, engine: "local-parser-roundtrip", checkedAt: new Date().toISOString(), bytes: 0,
      originalSheets: model.sheets.length, reopenedSheets: 0, originalFormulaCount: formulas(model), reopenedFormulaCount: 0,
      issues: [{ code: "EXPORT_BLOCKED", message: error instanceof Error ? error.message : String(error) }] };
  }
  let reopened: WorkbookModel;
  try { reopened = await parseFile(model.fileId, model.fileName.replace(/\.(xlsm?|xlsb|csv|tsv|txt|json|ndjson)$/i, ".xlsx"), bytes); }
  catch (error) {
    return { ok: false, engine: "local-parser-roundtrip", checkedAt: new Date().toISOString(), bytes: bytes.byteLength,
      originalSheets: model.sheets.length, reopenedSheets: 0, originalFormulaCount: formulas(model), reopenedFormulaCount: 0,
      issues: [{ code: "REOPEN_FAILED", message: error instanceof Error ? error.message : String(error) }] };
  }
  if (model.sheets.length !== reopened.sheets.length) issues.push({ code: "SHEET_COUNT_MISMATCH", message: "Worksheet count changed during export/reopen." });
  for (let i = 0; i < model.sheets.length; i++) {
    const before = model.sheets[i], after = reopened.sheets[i];
    if (!after) { issues.push({ code: "SHEET_MISSING", message: "Worksheet missing after reopen.", sheet: before.name }); continue; }
    if (before.name !== after.name) issues.push({ code: "SHEET_NAME_MISMATCH", message: "Worksheet name changed.", sheet: before.name });
    if (before.visibility !== after.visibility) issues.push({ code: "SHEET_VISIBILITY_MISMATCH", message: "Worksheet visibility changed.", sheet: before.name });
    const formulaCells = Object.values(before.cells).filter(c => !!c.f);
    for (const cell of formulaCells) {
      const actual = after.cells[cell.a];
      if (!actual?.f) issues.push({ code: "FORMULA_LOST", message: "Formula missing after export/reopen.", sheet: before.name, cell: cell.a });
      else if (actual.f !== cell.f) issues.push({ code: "FORMULA_CHANGED", message: "Formula text changed during export/reopen.", sheet: before.name, cell: cell.a });
    }
    const mergeKey = (m: { r1: number; c1: number; r2: number; c2: number }) => [m.r1,m.c1,m.r2,m.c2].join(":");
    const beforeMerges = before.merges.map(mergeKey).sort(), afterMerges = after.merges.map(mergeKey).sort();
    if (JSON.stringify(beforeMerges) !== JSON.stringify(afterMerges)) issues.push({ code: "MERGE_MISMATCH", message: "Merged-range coordinates changed.", sheet: before.name });
    for (const cell of Object.values(before.cells)) {
      const actual = after.cells[cell.a];
      if (!actual) { issues.push({ code: "CELL_MISSING", message: "Cell missing after export/reopen.", sheet: before.name, cell: cell.a }); continue; }
      // Readers may materialize default Excel styles ("General", empty fill/font records) for unstyled cells.
      // Only compare style metadata that was explicitly present in the source model.
      if (cell.s && JSON.stringify(cell.s) !== JSON.stringify(actual.s ?? null)) issues.push({ code: "STYLE_MISMATCH", message: "Explicit cell style changed during export/reopen.", sheet: before.name, cell: cell.a });
      const expectedFormat = cell.z && cell.z.toLowerCase() !== "general" ? cell.z : null;
      const actualFormat = actual.z && actual.z.toLowerCase() !== "general" ? actual.z : null;
      // Excel readers can assign a default display format to typed dates/numbers that had no
      // explicit format in the model. Only enforce equality when the source format was explicit.
      if (expectedFormat !== null && expectedFormat !== actualFormat) issues.push({ code: "NUMBER_FORMAT_MISMATCH", message: "Explicit cell number format changed during export/reopen.", sheet: before.name, cell: cell.a });
      if (!cell.f && (cell.v !== null || cell.t !== "z") && (cell.t !== actual.t || JSON.stringify(cell.v) !== JSON.stringify(actual.v))) {
        issues.push({ code: "CELL_CONTENT_MISMATCH", message: "Cell value or type changed during export/reopen.", sheet: before.name, cell: cell.a });
      }
    }
  }
  if (formulas(model) !== formulas(reopened)) issues.push({ code: "FORMULA_COUNT_MISMATCH", message: "Formula count changed during export/reopen." });
  if (stable([...(model.unsupportedFeatures ?? [])].sort()) !== stable([...(reopened.unsupportedFeatures ?? [])].sort())) issues.push({ code: "FEATURE_MARKERS_CHANGED", message: "Unsupported OOXML feature markers changed during export/reopen." });
  return { ok: issues.length === 0, engine: "local-parser-roundtrip", checkedAt: new Date().toISOString(), bytes: bytes.byteLength,
    originalSheets: model.sheets.length, reopenedSheets: reopened.sheets.length, originalFormulaCount: formulas(model), reopenedFormulaCount: formulas(reopened), issues };
}
export const countWorkbookCells = cells;
