import type { WorkbookModel } from "./types";

export interface ValueDiffRow {
  sheet: string;
  cell: string;
  before: string | number | null;
  after: string | number | null;
  formula?: string;
}

/**
 * Compare cached values on formula cells between two workbook models.
 * Used after recalculation to show what numbers changed on the copy.
 */
export function collectFormulaValueDiffs(
  before: WorkbookModel,
  after: WorkbookModel,
  limit = 200
): ValueDiffRow[] {
  const rows: ValueDiffRow[] = [];
  for (const sheet of before.sheets) {
    const afterSheet = after.sheets.find((s) => s.name === sheet.name);
    if (!afterSheet) continue;
    for (const addr of Object.keys(sheet.cells)) {
      const cell = sheet.cells[addr];
      if (!cell.f) continue;
      const other = afterSheet.cells[addr] ?? afterSheet.cells[addr.toUpperCase()] ?? afterSheet.cells[addr.toLowerCase()];
      const beforeV = cell.v ?? null;
      const afterV = other?.v ?? null;
      if (JSON.stringify(beforeV) === JSON.stringify(afterV)) continue;
      rows.push({
        sheet: sheet.name,
        cell: addr.toUpperCase(),
        before: beforeV as string | number | null,
        after: afterV as string | number | null,
        formula: cell.f,
      });
      if (rows.length >= limit) return rows;
    }
  }
  return rows;
}
