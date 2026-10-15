import type { CellModel, WorkbookModel } from "../types";

export type FormattingTheme = "report" | "financial";
export interface FormattingOptions { theme?: FormattingTheme; headerRow?: number; preserveExistingStyles?: boolean; preserveExistingColumnWidths?: boolean; bandedRows?: boolean; minColumnWidth?: number; maxColumnWidth?: number }
export interface FormattingChange { sheet: string; target: string; kind: "style" | "column-width"; before: unknown; after: unknown; reason: string }
export interface FormattingResult { model: WorkbookModel; changes: FormattingChange[] }

const THEMES = {
  report: {
    font: { name: "Aptos", sz: 10, color: { rgb: "FF243247" } },
    header: { fill: { patternType: "solid", fgColor: { rgb: "FF17365D" } }, font: { name: "Aptos Display", sz: 10, bold: true, color: { rgb: "FFFFFFFF" } }, alignment: { vertical: "center", horizontal: "left", wrapText: true }, border: { bottom: { style: "medium", color: { rgb: "FF4F81BD" } } } },
    band: { fill: { patternType: "solid", fgColor: { rgb: "FFF2F6FA" } } }
  },
  financial: {
    font: { name: "Aptos", sz: 10, color: { rgb: "FF1F2937" } },
    header: { fill: { patternType: "solid", fgColor: { rgb: "FF203864" } }, font: { name: "Aptos", sz: 10, bold: true, color: { rgb: "FFFFFFFF" } }, alignment: { vertical: "center", horizontal: "center", wrapText: true }, border: { bottom: { style: "double", color: { rgb: "FF70AD47" } } } },
    band: { fill: { patternType: "solid", fgColor: { rgb: "FFF3F6F4" } } }
  }
} as const;
function clone<T>(v: T): T { return v == null ? v : JSON.parse(JSON.stringify(v)) as T; }
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function mergeStyle(old: Record<string, unknown> | undefined, patch: Record<string, unknown>, preserve: boolean): Record<string, unknown> {
  if (!preserve) return clone(patch);
  const out: Record<string, unknown> = clone(old ?? {});
  for (const [key, value] of Object.entries(patch)) {
    if (out[key] === undefined) out[key] = clone(value);
    else if (isRecord(out[key]) && isRecord(value)) {
      // Preserve explicitly configured leaves while filling missing font/fill/border/alignment properties.
      out[key] = mergeStyle(out[key] as Record<string, unknown>, value, true);
    }
  }
  return out;
}
function colName(i: number): string { let n=i+1, s=""; while(n>0){const r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26);} return s; }
function widthOf(c: CellModel): number { const s = c.f ? "=" + c.f : c.v == null ? "" : String(c.v); return Math.min(80, ...s.split("\n").map(x=>x.length)); }

/** Applies a deterministic theme to the reduced workbook model; existing styles win by default. */
export function applyFormattingTheme(model: WorkbookModel, options: FormattingOptions = {}): FormattingResult {
  if (model.truncated) throw new Error("MODEL_TRUNCATED: formatting requires the complete workbook model.");
  const theme = THEMES[options.theme ?? "report"], preserve = options.preserveExistingStyles ?? true, preserveWidths = options.preserveExistingColumnWidths ?? true;
  const min = options.minColumnWidth ?? 10, max = options.maxColumnWidth ?? 42;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 1 || max < min) throw new Error("INVALID_WIDTH_BOUNDS: expected 1 <= minColumnWidth <= maxColumnWidth.");
  const result = clone(model), changes: FormattingChange[] = [];
  for (const sheet of result.sheets) {
    const headerRow = options.headerRow ?? 0;
    const headers = Object.values(sheet.cells).filter(c=>c.r===headerRow && typeof c.v==="string" && c.v.trim());
    const hasHeader = headers.length > 0, lengths = new Map<number,number>();
    for (const cell of Object.values(sheet.cells)) {
      lengths.set(cell.c, Math.max(lengths.get(cell.c) ?? min, widthOf(cell)+2));
      const header = hasHeader && cell.r===headerRow;
      const band = (options.bandedRows ?? true) && !header && cell.r>headerRow && cell.r%2===0;
      const alignment = cell.t === "n" ? "right" : cell.t === "d" ? "center" : "left";
      const patch: Record<string,unknown> = header
        ? clone(theme.header) as unknown as Record<string,unknown>
        : { font: clone(theme.font), alignment: { horizontal: alignment, vertical: "center" },
            border: { bottom: { style: "hair", color: { rgb: "FFD9E2F3" } } } };
      if (band) patch.fill = clone(theme.band.fill);
      const before=clone(cell.s), after=mergeStyle(cell.s,patch,preserve);
      if (JSON.stringify(before ?? {})!==JSON.stringify(after)) {
        cell.s=after; changes.push({sheet:sheet.name,target:cell.a,kind:"style",before:before ?? null,after:clone(after),reason:header?"Apply consistent header theme":band?"Apply alternating row band":"Apply readable baseline font"});
      }
    }
    const widths=[...(sheet.columnWidths ?? [])];
    for(let c=0;c<Math.max(0,sheet.cols);c++){
      if(widths[c]?.hidden) continue;
      const suggested=Math.max(min,Math.min(max,lengths.get(c) ?? min)), old=widths[c]?.wch;
      if(old===undefined || (!preserve && Math.abs(old-suggested)>0.5)){
        widths[c]={...(widths[c] ?? {}),wch:suggested};
        changes.push({sheet:sheet.name,target:colName(c)+":"+colName(c),kind:"column-width",before:old ?? null,after:suggested,reason:"Bounded content-based column width"});
      }
    }
    if(widths.length) sheet.columnWidths=widths;
  }
  return {model:result,changes};
}

export function inspectStyleConsistency(sheet: {cells: Record<string,CellModel>}): {styledCells:number;distinctStyles:number;cellsByStyle:Record<string,number>} {
  const counts:Record<string,number>={};
  for(const c of Object.values(sheet.cells)) if(c.s){const k=JSON.stringify(c.s);counts[k]=(counts[k]??0)+1;}
  return {styledCells:Object.values(sheet.cells).filter(c=>!!c.s).length,distinctStyles:Object.keys(counts).length,cellsByStyle:counts};
}