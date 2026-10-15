import type { CellModel, WorkbookModel } from "../types";

export type InferredColumnType = "empty" | "text" | "number" | "date" | "boolean" | "mixed";
export interface QualityFinding {
  code: "MIXED_TYPES" | "NUMBER_AS_TEXT" | "DATE_AS_TEXT" | "INVALID_DATE_TEXT" | "TEXT_WHITESPACE" | "FULLWIDTH_TEXT" | "FORMULA_ERROR" | "SUSPICIOUS_NEGATIVE" | "POSSIBLE_DUPLICATE_ROW" | "MISSING_KEY";
  severity: "info" | "warning" | "error";
  sheet: string;
  cell?: string;
  column?: number;
  message: string;
  evidence: Record<string, string | number | boolean | null>;
  repairable: false;
}
export interface ColumnProfile { sheet: string; column: number; header: string; inferredType: InferredColumnType; nonEmpty: number; typeCounts: Record<string, number> }
export interface QualityOptions { keyColumns?: Record<string, number[]>; quantityHeaderPattern?: RegExp; duplicateRowScan?: boolean }

const DATE = /^(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日)$/;
const NUM = /^[-+]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?%?$/;
const empty = (cell: CellModel | undefined) => !cell || cell.v === null || cell.v === "";
function validDateText(value: string): boolean {
  const western = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value);
  const japanese = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(value);
  const match = western ?? japanese;
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  // Date.UTC remaps years 0–99 to 1900–1999. Build from an epoch and set the
  // full year explicitly so valid early years are not misclassified as impossible dates.
  if (year < 1) return false;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function typeOf(cell: CellModel): string {
  if (empty(cell)) return "empty";
  if (cell.t === "b" || typeof cell.v === "boolean") return "boolean";
  if (cell.t === "d" || (typeof cell.v === "string" && DATE.test(cell.v))) return "date";
  if (cell.t === "n" || typeof cell.v === "number") return "number";
  if (typeof cell.v === "string" && NUM.test(cell.v.trim())) return "numeric-text";
  return "text";
}
function infer(types: string[]): InferredColumnType {
  const set = new Set(types.filter(type => type !== "empty").map(type => type === "numeric-text" ? "number" : type));
  if (!set.size) return "empty";
  if (set.size > 1) return "mixed";
  return [...set][0] as InferredColumnType;
}

/**
 * Read-only profiler. Cells are indexed once per sheet to keep profiling approximately O(cells),
 * including sparse worksheets; findings are never automatically applied.
 */
export function profileWorkbookQuality(model: WorkbookModel, options: QualityOptions = {}): { columns: ColumnProfile[]; findings: QualityFinding[] } {
  if (model.truncated) throw new Error("MODEL_TRUNCATED: quality profiling requires a complete workbook model.");
  const columns: ColumnProfile[] = [], findings: QualityFinding[] = [];
  const quantity = options.quantityHeaderPattern ?? /quantity|qty|count|units|items|数量/i;

  for (const sheet of model.sheets) {
    const byColumn = new Map<number, CellModel[]>();
    const byRow = new Map<number, CellModel[]>();
    const byRowColumn = new Map<number, Map<number, CellModel>>();
    const headers = new Map<number, string>();
    let maxColumnCount = Math.max(0, sheet.cols), maxRowCount = Math.max(0, sheet.rows);

    for (const cell of Object.values(sheet.cells)) {
      maxColumnCount = Math.max(maxColumnCount, cell.c + 1);
      maxRowCount = Math.max(maxRowCount, cell.r + 1);
      const column = byColumn.get(cell.c) ?? [];
      column.push(cell); byColumn.set(cell.c, column);
      const row = byRow.get(cell.r) ?? [];
      row.push(cell); byRow.set(cell.r, row);
      const rowMap = byRowColumn.get(cell.r) ?? new Map<number, CellModel>();
      rowMap.set(cell.c, cell); byRowColumn.set(cell.r, rowMap);
      if (cell.r === 0 && typeof cell.v === "string") headers.set(cell.c, cell.v.trim());
    }

    for (const [column, allCells] of byColumn) {
      const cells = allCells.filter(cell => cell.r > 0 && !empty(cell));
      const types = cells.map(typeOf), counts: Record<string, number> = {};
      for (const type of types) counts[type] = (counts[type] ?? 0) + 1;
      const header = headers.get(column) ?? "", inferredType = infer(types);
      if (cells.length) columns.push({ sheet: sheet.name, column, header, inferredType, nonEmpty: cells.length, typeCounts: counts });
      if (inferredType === "mixed") findings.push({
        code: "MIXED_TYPES", severity: "warning", sheet: sheet.name, column,
        message: "Column " + (header || column + 1) + " contains mixed data types.",
        evidence: { header, typeCounts: JSON.stringify(counts) }, repairable: false
      });

      for (const cell of cells) {
        const type = typeOf(cell);
        if (typeof cell.v === "string" && cell.v !== cell.v.trim()) findings.push({
          code: "TEXT_WHITESPACE", severity: "warning", sheet: sheet.name, cell: cell.a, column,
          message: "Text contains leading or trailing whitespace; review before trimming because whitespace can be meaningful.",
          evidence: { value: cell.v, suggestedValue: cell.v.trim(), header }, repairable: false
        });
        if (typeof cell.v === "string" && /[！-～　]/u.test(cell.v)) findings.push({
          code: "FULLWIDTH_TEXT", severity: "info", sheet: sheet.name, cell: cell.a, column,
          message: "Text contains full-width compatibility characters; normalization may change identifiers or user-entered text.",
          evidence: { value: cell.v, suggestedValue: cell.v.normalize("NFKC"), header }, repairable: false
        });
        if (cell.t === "e" || (typeof cell.v === "string" && /^#(?:REF!|DIV[/]0!|VALUE!|NAME[?]|N[/]A|NUM!|NULL!|SPILL!|CALC!|FIELD!|BLOCKED!)/i.test(cell.v))) findings.push({
          code: "FORMULA_ERROR", severity: "error", sheet: sheet.name, cell: cell.a, column,
          message: "Cell contains an Excel error value; inspect the formula, references and input data.",
          evidence: { value: typeof cell.v === "string" ? cell.v : null, formula: cell.f ?? null, header }, repairable: false
        });
        if (type === "numeric-text") findings.push({
          code: "NUMBER_AS_TEXT", severity: "info", sheet: sheet.name, cell: cell.a, column,
          message: "Numeric-looking text may need normalization; locale and identifier semantics require review.",
          evidence: { value: String(cell.v), header }, repairable: false
        });
        if (type === "date" && typeof cell.v === "string" && DATE.test(cell.v)) {
          if (!validDateText(cell.v)) findings.push({
            code: "INVALID_DATE_TEXT", severity: "error", sheet: sheet.name, cell: cell.a, column,
            message: "Date-shaped text is not a valid calendar date; no automatic correction was attempted.",
            evidence: { value: cell.v, header }, repairable: false
          });
          else {
            const year = Number(cell.v.match(/^\d{4}/)?.[0] ?? 0);
            if (year > 0 && (year < 1900 || year > new Date().getFullYear() + 20)) findings.push({
              code: "DATE_AS_TEXT", severity: "warning", sheet: sheet.name, cell: cell.a, column,
              message: "Date text contains an unusual year; confirm locale and century before repair.",
              evidence: { value: cell.v, year }, repairable: false
            });
          }
        }
        if (quantity.test(header) && typeof cell.v === "number" && cell.v < 0) findings.push({
          code: "SUSPICIOUS_NEGATIVE", severity: "warning", sheet: sheet.name, cell: cell.a, column,
          message: "Negative quantity-like value requires domain review; returns and corrections may be valid.",
          evidence: { value: cell.v, header }, repairable: false
        });
      }
    }

    if (options.duplicateRowScan ?? true) {
      const seen = new Map<string, number>();
      for (const [rowNumber, rowCells] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
        if (rowNumber === 0) continue;
        const populated = rowCells.filter(cell => !empty(cell)).sort((a, b) => a.c - b.c);
        if (!populated.length) continue;
        // Include column and type so sparse rows with the same value in different columns
        // are not falsely reported as duplicates. Formula text distinguishes computed rows.
        const key = JSON.stringify(populated.map(cell => [cell.c, cell.t, cell.v, cell.f ?? null]));
        const first = seen.get(key);
        if (first !== undefined) findings.push({
          code: "POSSIBLE_DUPLICATE_ROW", severity: "warning", sheet: sheet.name,
          message: "Row " + (rowNumber + 1) + " duplicates row " + (first + 1) + "; confirm whether accidental.",
          evidence: { row: rowNumber + 1, firstRow: first + 1 }, repairable: false
        });
        else seen.set(key, rowNumber);
      }
    }

    for (const column of options.keyColumns?.[sheet.name] ?? []) {
      if (!Number.isInteger(column) || column < 0 || column >= maxColumnCount) {
        findings.push({
          code: "MISSING_KEY", severity: "error", sheet: sheet.name, column,
          message: "Configured key column index is outside the worksheet's known column range.",
          evidence: { column, maxColumnCount }, repairable: false
        });
        continue;
      }
      for (let row = 1; row < maxRowCount; row++) {
        const cell = byRowColumn.get(row)?.get(column);
        if (empty(cell)) findings.push({
          code: "MISSING_KEY", severity: "error", sheet: sheet.name, cell: cell?.a, column,
          message: "Required key is missing at row " + (row + 1) + ".",
          evidence: { row: row + 1, column }, repairable: false
        });
      }
    }
  }
  return { columns, findings };
}
