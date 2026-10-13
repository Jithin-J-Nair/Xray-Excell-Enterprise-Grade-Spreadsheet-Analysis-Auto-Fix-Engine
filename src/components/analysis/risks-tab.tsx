"use client";
import { useMemo, useState } from "react";
import { Wrench, Filter } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { Panel, PanelTitle, SevBadge } from "@/components/ui";
import type { AnalysisDetail } from "./shared";
import type { Severity } from "@/lib/excel/types";

const SEV_ORDER: Record<Severity, number> = { critical: 0, error: 1, warning: 2, info: 3 };

export function RisksTab({ detail, onJumpTool }: { detail: AnalysisDetail; onJumpTool?: (ruleId: string) => void }) {
  const { t } = useI18n();
  const risks = detail.result!.risks;
  const counts = detail.result!.riskCounts;
  const [sev, setSev] = useState<string>("all");
  const [type, setType] = useState<string>("all");
  const [q, setQ] = useState("");

  const types = useMemo(() => Object.keys(counts).sort(), [counts]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return risks
      .filter((r) => (sev === "all" ? true : r.severity === sev))
      .filter((r) => (type === "all" ? true : r.type === type))
      .filter((r) =>
        query
          ? r.message.toLowerCase().includes(query) ||
            (r.sheet ?? "").toLowerCase().includes(query) ||
            (r.cell ?? "").toLowerCase().includes(query) ||
            r.type.toLowerCase().includes(query)
          : true
      )
      .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  }, [risks, sev, type, q]);

  return (
    <Panel className="overflow-hidden">
      <PanelTitle
        right={
          <div className="flex items-center gap-2">
            <Filter size={13} className="text-dim" />
            <select value={sev} onChange={(e) => setSev(e.target.value)} className="!py-1 !px-2 text-xs">
              <option value="all">{t("risks.filter.all")}</option>
              {(["critical", "error", "warning", "info"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`an.sev.${s}`)} ({detail.result!.metrics.risksBySeverity[s]})
                </option>
              ))}
            </select>
            <select value={type} onChange={(e) => setType(e.target.value)} className="!py-1 !px-2 text-xs max-w-[220px]">
              <option value="all">{t("risks.type")} — all</option>
              {types.map((ty) => (
                <option key={ty} value={ty}>
                  {t(`risk.${ty}`)} ({counts[ty as keyof typeof counts]})
                </option>
              ))}
            </select>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="filter…"
              className="!py-1 !px-2 text-xs w-32"
            />
          </div>
        }
      >
        {t("an.tabs.risks")} · {filtered.length}/{risks.length}
      </PanelTitle>
      <div className="max-h-[600px] overflow-auto">
        <table className="table-x">
          <thead>
            <tr>
              <th className="w-16">ID</th>
              <th className="w-24">severity</th>
              <th className="w-44">{t("risks.type")}</th>
              <th className="w-40">{t("risks.location")}</th>
              <th>{t("risks.desc")}</th>
              <th className="w-24">{t("risks.fix")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td className="mono text-[10px] text-dim">{r.id}</td>
                <td>
                  <SevBadge sev={r.severity} label={t(`an.sev.${r.severity}`)} />
                </td>
                <td className="text-xs font-medium">{t(`risk.${r.type}`)}</td>
                <td className="mono text-[11px] text-accent/90">
                  {[r.sheet, r.cell].filter(Boolean).join("!") || <span className="text-dim">workbook</span>}
                </td>
                <td className="text-xs">
                  <div className="text-txt/90">{r.message}</div>
                  <div className="text-dim mono text-[10.5px] mt-0.5 break-all">{r.explanation}</div>
                </td>
                <td>
                  {r.ruleId ? (
                    <button
                      onClick={() => onJumpTool?.(r.ruleId!)}
                      className="chip text-ok border-ok/35 bg-ok/10 hover:bg-ok/20 transition-colors"
                      title={t("risks.fixable")}
                    >
                      <Wrench size={10} />
                      {r.ruleId}
                    </button>
                  ) : (
                    <span className="text-dim text-[10px]">manual</span>
                  )}
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={6} className="text-center text-dim text-sm py-10">
                  {t("common.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
