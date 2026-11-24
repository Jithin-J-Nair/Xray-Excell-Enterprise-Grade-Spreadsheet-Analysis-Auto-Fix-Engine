/**
 * Role-oriented check packs for Japanese workbook workflows.
 * Each pack selects known structural issue types — not financial correctness.
 */
import type { AnalysisResult, Risk, RiskType } from "./types";

export interface CheckPack {
  id: string;
  nameKey: string;
  descKey: string;
  /** Risk types this pack highlights */
  riskTypes: RiskType[];
}

export const CHECK_PACKS: CheckPack[] = [
  {
    id: "keiri",
    nameKey: "pack.keiri.name",
    descKey: "pack.keiri.desc",
    riskTypes: [
      "DATE_AS_TEXT",
      "NUMBER_AS_TEXT",
      "ERROR_CELL",
      "CIRCULAR_REF",
      "EXTERNAL_LINK",
      "BROKEN_NAMED_RANGE",
      "WHITESPACE",
      "UNICODE_FULLWIDTH",
    ],
  },
  {
    id: "yosan",
    nameKey: "pack.yosan.name",
    descKey: "pack.yosan.desc",
    riskTypes: [
      "HARDCODED_NUMBER",
      "INCONSISTENT_FORMULA",
      "CIRCULAR_REF",
      "VOLATILE_FUNCTION",
      "EXTERNAL_LINK",
      "MERGED_CELLS",
    ],
  },
  {
    id: "seikyu",
    nameKey: "pack.seikyu.name",
    descKey: "pack.seikyu.desc",
    riskTypes: [
      "DUPLICATE_ROWS",
      "WHITESPACE",
      "UNICODE_FULLWIDTH",
      "NUMBER_AS_TEXT",
      "DATE_AS_TEXT",
      "MIXED_TYPES",
      "ERROR_CELL",
    ],
  },
];

export function packById(id: string): CheckPack | undefined {
  return CHECK_PACKS.find((p) => p.id === id);
}

export interface PackSummary {
  packId: string;
  matchingRisks: number;
  byType: Record<string, number>;
  sample: Risk[];
}

/** Summarize how many analysis findings fall into a role pack. */
export function summarizePack(result: AnalysisResult, packId: string): PackSummary | null {
  const pack = packById(packId);
  if (!pack) return null;
  const typeSet = new Set(pack.riskTypes);
  const matching = result.risks.filter((r) => typeSet.has(r.type));
  const byType: Record<string, number> = {};
  for (const t of pack.riskTypes) {
    const n = result.riskCounts[t] ?? 0;
    if (n) byType[t] = n;
  }
  const totalFromCounts = pack.riskTypes.reduce((a, t) => a + (result.riskCounts[t] ?? 0), 0);
  return {
    packId,
    matchingRisks: totalFromCounts || matching.length,
    byType,
    sample: matching.slice(0, 8),
  };
}

export function summarizeAllPacks(result: AnalysisResult): PackSummary[] {
  return CHECK_PACKS.map((p) => summarizePack(result, p.id)!).filter(Boolean);
}
