// ── X-RAY://EXCEL v2 — core domain types (isomorphic: server + browser) ──────

export type CellType = "n" | "s" | "b" | "e" | "d" | "z";

export interface CellModel {
  /** A1 address, e.g. "B3" */
  a: string;
  r: number;
  c: number;
  t: CellType;
  /** raw value: number | string | boolean | ISO date string | null */
  v: string | number | boolean | null;
  /** formula WITHOUT leading "=" */
  f?: string;
  /** Excel number-format code (e.g. "0.00", "yyyy-mm-dd"). */
  z?: string;
  /** Basic Excel cell style payload supported by xlsx-js-style (font/fill/border/alignment). */
  s?: Record<string, unknown>;
}

export interface MergeRange {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export type SheetVisibility = "visible" | "hidden" | "veryHidden";

export interface SheetModel {
  name: string;
  visibility: SheetVisibility;
  rows: number;
  cols: number;
  /** address -> cell */
  cells: Record<string, CellModel>;
  merges: MergeRange[];
  /** Column widths and row heights, indexed by column/row. */
  columnWidths?: { wch?: number; wpx?: number; hidden?: boolean }[];
  rowHeights?: { hpt?: number; hpx?: number; hidden?: boolean }[];
}

export interface NamedRangeModel {
  name: string;
  ref: string;
  sheet?: string | null;
  broken: boolean;
}

export interface WorkbookModel {
  fileId: string;
  fileName: string;
  encoding?: string;
  sheets: SheetModel[];
  names: NamedRangeModel[];
  truncated?: boolean;
  /** True for macro-enabled inputs; reconstruction to .xlsx would drop VBA. */
  macroEnabled?: boolean;
}

// ── Formula tokens ───────────────────────────────────────────────────────────

export interface FormulaRef {
  raw: string;
  /** sheet qualifier without quotes / brackets info in `book` */
  sheet: string | null;
  /** external workbook name when ref like [Book.xlsx]Sheet!A1, else null */
  book: string | null;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  absRow1: boolean;
  absCol1: boolean;
  absRow2: boolean;
  absCol2: boolean;
}

export interface ParsedFormula {
  refs: FormulaRef[];
  functions: string[];
  /** numeric literals */
  numbers: string[];
  /** bare identifiers (named range candidates) */
  identifiers: string[];
}

// ── Analysis results ─────────────────────────────────────────────────────────

export type Severity = "critical" | "error" | "warning" | "info";

export interface Risk {
  id: string;
  type: RiskType;
  severity: Severity;
  sheet?: string | null;
  cell?: string | null;
  file?: string | null;
  /** localization key + params; `message` is EN fallback */
  message: string;
  explanation: string;
  params?: Record<string, string | number>;
  /** tool rule id that can fix this risk (if any) */
  ruleId?: string | null;
  count?: number;
}

export type RiskType =
  | "CIRCULAR_REF"
  | "VOLATILE_FUNCTION"
  | "EXTERNAL_LINK"
  | "HARDCODED_NUMBER"
  | "MERGED_CELLS"
  | "HIDDEN_SHEET"
  | "INCONSISTENT_FORMULA"
  | "BROKEN_NAMED_RANGE"
  | "ERROR_CELL"
  | "DUPLICATE_ROWS"
  | "MIXED_TYPES"
  | "WHITESPACE"
  | "UNICODE_FULLWIDTH"
  | "DATE_AS_TEXT"
  | "NUMBER_AS_TEXT"
  | "ENCODING"
  | "EMPTY_SHEET"
  | "LONG_FORMULA";

export interface GraphNode {
  id: string;
  sheet: string;
  addr: string;
  formula: boolean;
  external?: boolean;
  missing?: boolean;
  cycle?: boolean;
  file?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: "intra" | "cross" | "cross-file" | "external" | "missing";
  cycle?: boolean;
}

export interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

export interface SheetSummary {
  name: string;
  visibility: SheetVisibility;
  rows: number;
  cols: number;
  cells: number;
  formulas: number;
  errors: number;
  file: string;
}

export interface AnalysisMetrics {
  files: number;
  sheets: number;
  cells: number;
  formulas: number;
  functions: number;
  volatile: number;
  circular: number;
  externalLinks: number;
  merged: number;
  hiddenSheets: number;
  hardcoded: number;
  names: number;
  brokenNames: number;
  duplicateRows: number;
  errorCells: number;
  risksBySeverity: Record<Severity, number>;
  riskScore: number;
  healthScore: number;
}

export interface FormulaRecord {
  sheet: string;
  cell: string;
  f: string;
  file: string;
}

export interface AnalysisResult {
  name: string;
  language: "en" | "jp";
  files: { id: string; name: string; size: number; encoding?: string; sheets: number; formulas: number; cells: number }[];
  sheets: SheetSummary[];
  risks: Risk[];
  riskCounts: Partial<Record<RiskType, number>>;
  metrics: AnalysisMetrics;
  graph: DependencyGraph;
  formulas: FormulaRecord[];
  formulasTruncated: boolean;
  volatileList: { sheet: string; cell: string; fn: string }[];
  hardcodedList: { sheet: string; cell: string; literal: string; file?: string }[];
  model: WorkbookModel;
}

// ── Transformations ──────────────────────────────────────────────────────────

export type ToolGroup = "organize" | "clean" | "mitigate" | "custom";

export interface ToolDef {
  id: string;
  group: ToolGroup;
  nameKey: string;
  descKey: string;
  /** EN fallback */
  name: string;
  desc: string;
  safeDefault: boolean;
  autoFix: boolean;
  targets: RiskType[];
}

export interface Diff {
  sheet: string;
  cell: string;
  before: string | number | null;
  after: string | number | null;
  kind: "value" | "formula" | "structure" | "name" | "row";
  ruleId: string;
  /** EN fallback reason; UI localizes via ruleId + params */
  reason: string;
  params?: Record<string, string | number>;
  confidence: number;
  riskDelta: "down" | "neutral" | "up";
}

export interface TransformOutput {
  model: WorkbookModel;
  diffs: Diff[];
  summary: {
    cellsChanged: number;
    formulasChanged: number;
    rowsRemoved: number;
    namesFixed: number;
    mergesRemoved: number;
    sheetsAdded: string[];
    byTool: Record<string, number>;
    riskScoreBefore: number;
    riskScoreAfter: number;
    risksResolved: number;
  };
}

export const VOLATILE_FUNCTIONS = new Set([
  "NOW",
  "TODAY",
  "RAND",
  "RANDBETWEEN",
  "OFFSET",
  "INDIRECT",
  "CELL",
  "INFO",
]);
