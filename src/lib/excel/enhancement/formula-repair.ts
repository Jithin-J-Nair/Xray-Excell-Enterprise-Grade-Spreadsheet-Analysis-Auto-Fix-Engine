import type { WorkbookModel } from "../types";
import { abstractFormula, instantiateTemplate, VOLATILE_FUNCTIONS } from "../formula";

export interface FormulaRepairProposal {
  sheet: string; cell: string; before: string; proposed: string; confidence: number;
  evidence: { supportingFormulas: number; nearbyFormulaCount: number; consensus: number };
  reason: string; applied: boolean;
}
export interface FormulaRepairOptions { apply?: boolean; minConfidence?: number; neighborRadius?: number; minSupportingFormulas?: number }
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function isUnsafeFormula(formula: string): boolean {
  if (/\[[^\]]+\][^!]*!/.test(formula)) return true;
  const functions = formula.toUpperCase().match(/\b[A-Z_][A-Z0-9_.]*(?=\s*\()/g) ?? [];
  return functions.some(name => VOLATILE_FUNCTIONS.has(name));
}
/**
 * Detects structural formula outliers using nearby R1C1-style templates. This is not business-logic
 * inference: proposals are review-only by default and must never be represented as semantically proven.
 */
export function proposeFormulaRepairs(model: WorkbookModel, options: FormulaRepairOptions = {}): { model: WorkbookModel; proposals: FormulaRepairProposal[] } {
  if (model.truncated) throw new Error("MODEL_TRUNCATED: formula analysis requires a complete workbook model.");
  const result = clone(model), proposals: FormulaRepairProposal[] = [];
  const radius = options.neighborRadius ?? 3, minSupport = options.minSupportingFormulas ?? 2;
  const threshold = options.minConfidence ?? 0.95;
  if (!Number.isInteger(radius) || radius < 1 || radius > 20) throw new Error("INVALID_NEIGHBOR_RADIUS");
  for (const sheet of result.sheets) {
    const byColumn = new Map<number, Array<{ r: number; c: number; a: string; f: string; template: string }>>();
    for (const cell of Object.values(sheet.cells)) {
      if (!cell.f || isUnsafeFormula(cell.f)) continue;
      const list = byColumn.get(cell.c) ?? [];
      list.push({ r: cell.r, c: cell.c, a: cell.a, f: cell.f, template: abstractFormula(cell.f, cell.r, cell.c) });
      byColumn.set(cell.c, list);
    }
    for (const formulas of byColumn.values()) {
      formulas.sort((a,b) => a.r-b.r);
      for (const candidate of formulas) {
        const nearby = formulas.filter(other => other.a !== candidate.a && Math.abs(other.r-candidate.r) <= radius);
        if (nearby.length < minSupport || isUnsafeFormula(candidate.f)) continue;
        const counts = new Map<string, number>();
        for (const neighbor of nearby) counts.set(neighbor.template, (counts.get(neighbor.template) ?? 0) + 1);
        const ranked = [...counts.entries()].sort((a,b) => b[1]-a[1]);
        if (!ranked.length || ranked.length > 1 && ranked[0][1] === ranked[1][1]) continue;
        const [template, support] = ranked[0];
        const consensus = support / nearby.length;
        if (template === candidate.template || support < minSupport || consensus < 0.8) continue;
        const proposed = instantiateTemplate(template, candidate.r, candidate.c);
        if (isUnsafeFormula(proposed)) continue;
        const confidence = Math.min(0.99, 0.75 + consensus * 0.2 + Math.min(support, 4) * 0.01);
        const shouldApply = options.apply === true && confidence >= threshold;
        proposals.push({ sheet: sheet.name, cell: candidate.a, before: candidate.f, proposed, confidence,
          evidence: { supportingFormulas: support, nearbyFormulaCount: nearby.length, consensus },
          reason: "Nearby formulas share a dominant structural template. Business semantics have not been inferred; review referenced columns and expected units before applying.",
          applied: shouldApply });
        if (shouldApply) {
          const target = sheet.cells[candidate.a];
          if (target) target.f = proposed;
        }
      }
    }
  }
  return { model: result, proposals };
}
