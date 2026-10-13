"use client";
import { useMemo, useRef, useState } from "react";
import { useI18n } from "@/components/i18n";
import { Panel, PanelTitle } from "@/components/ui";
import type { AnalysisDetail } from "./shared";
import { addrOf, colToName } from "@/lib/excel/formula";

const ROW_H = 26;
const COL_W = 148;
const ROWS_PER_PAGE = 60;

export function SheetsTab({ detail }: { detail: AnalysisDetail }) {
  const { t } = useI18n();
  const res = detail.result!;
  const sheets = res.model.sheets;
  const [sheetIdx, setSheetIdx] = useState(0);
  const [showFormulas, setShowFormulas] = useState(false);
  const [page, setPage] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const sheet = sheets[Math.min(sheetIdx, sheets.length - 1)];

  const riskCells = useMemo(() => {
    const set = new Set<string>();
    for (const r of res.risks) if (r.sheet === sheet?.name && r.cell) set.add(r.cell.toUpperCase());
    return set;
  }, [res.risks, sheet]);

  const cols = Math.min(sheet?.cols ?? 1, 60);
  const rows = sheet?.rows ?? 1;
  const pages = Math.max(1, Math.ceil(rows / ROWS_PER_PAGE));
  const startRow = page * ROWS_PER_PAGE;
  const endRow = Math.min(rows, startRow + ROWS_PER_PAGE);

  return (
    <Panel className="overflow-hidden" glow>
      <PanelTitle
        right={
          <div className="flex items-center gap-2.5">
            <select
              value={sheetIdx}
              onChange={(e) => {
                setSheetIdx(Number(e.target.value));
                setPage(0);
              }}
              className="!py-1 !px-2 text-xs max-w-[240px]"
            >
              {sheets.map((s, i) => (
                <option key={s.name} value={i}>
                  {s.name} {s.visibility !== "visible" ? `(${s.visibility})` : ""}
                </option>
              ))}
            </select>
            <button
              onClick={() => setShowFormulas((v) => !v)}
              className={`btn text-[11px] !py-1 !px-2.5 ${showFormulas ? "btn-primary" : "btn-ghost"}`}
            >
              {showFormulas ? t("sheets.formulas") : t("sheets.values")}
            </button>
          </div>
        }
      >
        {t("an.tabs.sheets")} · <span className="text-accent">{sheet?.name}</span> · {rows.toLocaleString()} × {sheet?.cols.toLocaleString()}
        {sheet && sheet.merges.length > 0 && <span className="text-warn ml-2">· {sheet.merges.length} {t("sheets.merged.badge")}</span>}
      </PanelTitle>

      <div className="overflow-x-auto border-t border-edge/60" ref={scrollRef}>
        <table className="border-collapse" style={{ tableLayout: "fixed", width: 46 + cols * COL_W }}>
          <thead>
            <tr>
              <th className="sticky top-0 z-10 bg-ink text-dim text-[10px] mono border-b border-r border-edge/70 w-[46px]"></th>
              {Array.from({ length: cols }, (_, c) => (
                <th key={c} style={{ width: COL_W, height: 24 }} className="sticky top-0 z-10 bg-ink text-dim text-[10px] mono font-medium border-b border-r border-edge/50">
                  {colToName(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: endRow - startRow }, (_, i) => {
              const r = startRow + i;
              return (
                <tr key={r} style={{ height: ROW_H }}>
                  <td className="text-center text-[10px] mono text-dim bg-ink/70 border-r border-edge/70 select-none">{r + 1}</td>
                  {Array.from({ length: cols }, (_, c) => {
                    const a = addrOf(r, c);
                    const cell = sheet?.cells[a] ?? sheet?.cells[a.toUpperCase()];
                    const risky = riskCells.has(a.toUpperCase());
                    const text = cell
                      ? showFormulas && cell.f
                        ? `=${cell.f}`
                        : cell.v === null || cell.v === undefined
                          ? cell.f
                            ? `=${cell.f}`
                            : ""
                          : cell.t === "d"
                            ? String(cell.v).slice(0, 10)
                            : String(cell.v)
                      : "";
                    return (
                      <td
                        key={c}
                        title={cell?.f ? `=${cell.f}` : text}
                        className={`px-1.5 text-[11px] mono truncate border-r border-b border-edge/30 ${
                          risky
                            ? "bg-hot/15 text-hot"
                            : cell?.f
                              ? "text-accent/90 bg-accent/[0.04]"
                              : cell?.t === "e"
                                ? "text-hot/90"
                                : "text-txt/85"
                        }`}
                      >
                        {text}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center gap-1.5 px-4 py-2.5 border-t border-edge/60 overflow-x-auto">
          {Array.from({ length: Math.min(pages, 24) }, (_, p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`mono text-[10px] px-2 py-1 rounded ${p === page ? "bg-accent/20 text-accent" : "text-dim hover:bg-white/5"}`}
            >
              {p * ROWS_PER_PAGE + 1}–{Math.min(rows, (p + 1) * ROWS_PER_PAGE)}
            </button>
          ))}
          {pages > 24 && <span className="text-dim text-[10px] mono">… {rows.toLocaleString()} rows</span>}
        </div>
      )}
    </Panel>
  );
}
