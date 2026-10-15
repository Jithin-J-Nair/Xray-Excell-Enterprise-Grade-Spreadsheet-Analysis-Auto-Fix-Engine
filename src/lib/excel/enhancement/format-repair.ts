import type { CellModel, WorkbookModel } from "../types";

export type NumberFormatKind = "date" | "currency" | "percentage" | "integer" | "decimal";
export interface FormatFinding {
  sheet: string; cell: string; kind: NumberFormatKind; currentFormat: string | null;
  proposedFormat: string; confidence: number; reason: string; applied: boolean;
}
export interface FormatRepairOptions {
  /** Minimum confidence required for explicit repair; inspection itself is always read-only. */
  apply?: boolean; minConfidence?: number; overwriteExisting?: boolean;
  currencyCode?: "USD" | "EUR" | "GBP" | "JPY" | "CAD" | "AUD";
}
const DATE_HEADER = /date|日付|年月日|日期/i;
const PERCENT_HEADER = /percent|percentage|rate|ratio|margin|growth|割合|率|比率/i;
const CURRENCY_HEADER = /price|cost|amount|revenue|sales|total|balance|salary|budget|円|金額|売上|価格|費用/i;
const INTEGER_HEADER = /count|quantity|qty|units|items|number|件数|数量|個数/i;
const CURRENCY_FORMAT: Record<NonNullable<FormatRepairOptions["currencyCode"]>, string> = {
  USD: '"$"#,##0.00;[Red]("$"#,##0.00)', EUR: '"€"#,##0.00;[Red]("€"#,##0.00)',
  GBP: '"£"#,##0.00;[Red]("£"#,##0.00)', JPY: '"¥"#,##0;[Red]("¥"#,##0)',
  CAD: '"CA$"#,##0.00;[Red]("CA$"#,##0.00)', AUD: '"A$"#,##0.00;[Red]("A$"#,##0.00)',
};
const clone = <T,>(value: T): T => value == null ? value : JSON.parse(JSON.stringify(value)) as T;
function headerFor(model: WorkbookModel, sheetName: string, column: number): string {
  const sheet = model.sheets.find(s => s.name === sheetName);
  const cell = sheet && Object.values(sheet.cells).find(c => c.c === column && c.r === 0);
  return typeof cell?.v === "string" ? cell.v.trim() : "";
}
function validDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return false;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value.slice(0, 10);
}
function currentKind(format: string | undefined): NumberFormatKind | null {
  if (!format) return null;
  if (/[ymdhis]/i.test(format) && !/[#0?]/.test(format)) return "date";
  if (format.includes("%")) return "percentage";
  if (/[$€£¥]|USD|EUR|GBP|JPY/i.test(format)) return "currency";
  if (/0\.0+/.test(format)) return "decimal";
  if (/0/.test(format)) return "integer";
  return null;
}
/** Infer format proposals from header semantics and value evidence. Never changes values or formulas. */
export function inspectNumberFormats(model: WorkbookModel, options: FormatRepairOptions = {}): FormatFinding[] {
  if (model.truncated) throw new Error("MODEL_TRUNCATED: format inspection requires a complete workbook model.");
  const findings: FormatFinding[] = [];
  const currency = options.currencyCode ?? "USD";
  for (const sheet of model.sheets) {
    for (const cell of Object.values(sheet.cells)) {
      if (cell.r === 0 || cell.f || (typeof cell.v !== "number" && cell.t !== "d")) continue;
      const header = headerFor(model, sheet.name, cell.c);
      const sample = Object.values(sheet.cells).filter(c => c.c === cell.c && c.r > 0 && c.v !== null);
      let kind: NumberFormatKind | null = null, proposed = "", confidence = 0, reason = "";
      if (cell.t === "d" || validDate(cell.v)) {
        kind = "date"; proposed = "yyyy-mm-dd"; confidence = cell.t === "d" ? 0.99 : 0.96;
        reason = "Cell is typed as a date or contains an unambiguous ISO date.";
      } else if (DATE_HEADER.test(header) && typeof cell.v === "number" && cell.v > 1 && cell.v < 2958466) {
        kind = "date"; proposed = "yyyy-mm-dd"; confidence = 0.68;
        reason = "Header suggests a date but numeric serial semantics are ambiguous; confirm before applying.";
      } else if (PERCENT_HEADER.test(header)) {
        const nums = sample.filter(c => typeof c.v === "number").map(c => c.v as number);
        // Percent units are ambiguous: 0.15 can mean 15% or 0.15%. Do not guess scaling.
        if (nums.length && nums.every(n => n >= 0 && n <= 1)) {
          kind = "percentage"; proposed = "0.0%"; confidence = 0.72;
          reason = "Header suggests a rate and values are within [0,1]; verify the workbook's unit convention before applying.";
        }
      } else if (CURRENCY_HEADER.test(header)) {
        kind = "currency"; proposed = CURRENCY_FORMAT[currency]; confidence = options.currencyCode ? 0.86 : 0.62;
        reason = options.currencyCode ? "Currency explicitly configured by caller." : "Header suggests currency, but currency cannot be inferred reliably.";
      } else if (INTEGER_HEADER.test(header) && Number.isInteger(cell.v)) {
        kind = "integer"; proposed = "#,##0;[Red](#,##0)"; confidence = 0.88;
        reason = "Header suggests a count and this cell is an integer.";
      } else if (typeof cell.v === "number") {
        kind = "decimal"; proposed = "#,##0.00;[Red](#,##0.00)"; confidence = 0.45;
        reason = "Generic numeric default; insufficient semantic evidence for automatic repair.";
      }
      if (!kind) continue;
      const existingKind = currentKind(cell.z);
      if (cell.z && !options.overwriteExisting) {
        if (existingKind === kind) continue;
        // An existing explicit format can encode intent (including IDs/leading zeros); leave it for review.
        confidence = Math.min(confidence, 0.49);
        reason += " Existing number format differs and may be intentional.";
      }
      // Inspection is always read-only. Applying changes is a separate explicit operation.
      findings.push({ sheet: sheet.name, cell: cell.a, kind, currentFormat: cell.z ?? null, proposedFormat: proposed, confidence, reason, applied: false });
    }
  }
  return findings;
}
export function repairNumberFormats(model: WorkbookModel, options: FormatRepairOptions = {}): { model: WorkbookModel; findings: FormatFinding[] } {
  const copy = clone(model);
  const findings = inspectNumberFormats(copy, options);
  const minConfidence = options.minConfidence ?? 0.9;
  const applied = findings.map(finding => {
    const sheet = copy.sheets.find(s => s.name === finding.sheet);
    const cell = sheet?.cells[finding.cell];
    const allowed = (options.apply ?? true) && finding.confidence >= minConfidence &&
      (!finding.currentFormat || options.overwriteExisting === true);
    if (allowed && cell) cell.z = finding.proposedFormat;
    return { ...finding, applied: !!(allowed && cell) };
  });
  return { model: copy, findings: applied };
}
