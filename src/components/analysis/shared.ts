import type { AnalysisResult } from "@/lib/excel/types";

export interface JobRow {
  id: string;
  kind: string;
  status: string;
  progress: number;
  formats: string[];
  outputs: { format: string; fileId: string; name: string; size: number }[];
  summary: Record<string, unknown>;
  error: string | null;
  reverted: boolean;
  undoFileId: string | null;
  patchFileId: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface AuditRow {
  id: string;
  action: string;
  detail: unknown;
  at: string;
}

export interface AnalysisDetail {
  id: string;
  name: string;
  mode: "server" | "local";
  status: string;
  progress: number;
  statusText: string;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  options: { resolveCrossFile?: boolean; language?: "en" | "jp" };
  result: AnalysisResult | null;
  sourceFiles: { id: string; name: string; size: number; mime: string; sha256: string | null }[];
  jobs: JobRow[];
  audit: AuditRow[];
}

export interface StatusPayload {
  status: string;
  progress: number;
  statusText: string;
  error: string | null;
  log: { t: string; msg: string }[];
  metrics: { riskScore: number; healthScore: number; risks: number; formulas: number } | null;
}
