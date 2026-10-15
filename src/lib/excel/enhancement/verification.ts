import type { CellModel, WorkbookModel } from "../types";
import { parseFile } from "../parse";
import { workbookToXlsxBytes } from "../serialize";

export interface VerificationIssue { code: string; message: string; sheet?: string; cell?: string }
export interface VerificationReport {
  ok: boolean; engine: "local-parser-roundtrip"; checkedAt: string; bytes: number;
  originalSheets: number; reopenedSheets: number; originalFormulaCount: number; reopenedFormulaCount: number;
  issues: VerificationIssue[];
}
const cells = (model: WorkbookModel) => model.sheets.reduce((n, s) => n + Object.keys(s.cells).length, 0);
const formulas = (model: WorkbookModel) => model.sheets.reduce((n, s) => n + Object.values(s.cells).filter(c => !!c.f).length, 0);
function cellSignature(c: CellModel | undefined): string {
  if (!c) return "<missing>";
  return JSON.stringify({ t: c.t, v: c.v, f: c.f, z: c.z, s: c.s });
}
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
    if (before.merges.length !== after.merges.length) issues.push({ code: "MERGE_MISMATCH", message: "Merged-range count changed.", sheet: before.name });
    for (const cell of Object.values(before.cells)) {
      const actual = after.cells[cell.a];
      if (!actual) { issues.push({ code: "CELL_MISSING", message: "Cell missing after export/reopen.", sheet: before.name, cell: cell.a }); continue; }
      if (cell.v !== null && cellSignature(cell) !== cellSignature(actual)) {
        // Formula caches can be normalized by readers; formula presence/text is checked separately.
        if (!(cell.f && actual.f === cell.f)) issues.push({ code: "CELL_CONTENT_MISMATCH", message: "Cell value/type/style/number format changed.", sheet: before.name, cell: cell.a });
      }
    }
  }
  if (formulas(model) !== formulas(reopened)) issues.push({ code: "FORMULA_COUNT_MISMATCH", message: "Formula count changed during export/reopen." });
  return { ok: issues.length === 0, engine: "local-parser-roundtrip", checkedAt: new Date().toISOString(), bytes: bytes.byteLength,
    originalSheets: model.sheets.length, reopenedSheets: reopened.sheets.length, originalFormulaCount: formulas(model), reopenedFormulaCount: formulas(reopened), issues };
}
export const countWorkbookCells = cells;
