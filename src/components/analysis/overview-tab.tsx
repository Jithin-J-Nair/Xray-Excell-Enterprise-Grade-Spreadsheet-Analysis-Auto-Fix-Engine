"use client";
import { useMemo, useState } from "react";
import { FileSpreadsheet, EyeOff, ShieldAlert, FileCode, Type, ClipboardList } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { Donut, HBars } from "@/components/charts";
import { Panel, PanelTitle, SevBadge, fmtBytes, fmtNum } from "@/components/ui";
import type { AnalysisDetail } from "./shared";
import { CHECK_PACKS, summarizeAllPacks } from "@/lib/excel/check-packs";

export function OverviewTab({ detail }: { detail: AnalysisDetail }) {
  const { t, lang } = useI18n();
  const res = detail.result!;
  const m = res.metrics;
  const [activePack, setActivePack] = useState<string>("keiri");
  const packSummaries = useMemo(() => summarizeAllPacks(res), [res]);
  const activeSummary = packSummaries.find((p) => p.packId === activePack) ?? packSummaries[0];

  const sevItems = (["critical", "error", "warning", "info"] as const).map((s) => ({
    label: t(`an.sev.${s}`),
    value: m.risksBySeverity[s],
    color: { critical: "#ff4a1f", error: "#fb7185", warning: "#e8a317", info: "#9c9ea3" }[s],
  }));

  const topTypes = Object.entries(res.riskCounts)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, 6)
    .map(([type, n]) => ({
      label: t(`risk.${type}`),
      value: n ?? 0,
      color: "#ff4a1f",
    }));

  const metricTiles: { key: string; value: number; icon: typeof Type; color: string }[] = [
    { key: "an.metric.sheets", value: m.sheets, icon: FileSpreadsheet, color: "#ff6a45" },
    { key: "an.metric.cells", value: m.cells, icon: Type, color: "#9c9ea3" },
    { key: "an.metric.formulas", value: m.formulas, icon: FileCode, color: "#eff0f1" },
    { key: "an.metric.volatile", value: m.volatile, icon: ShieldAlert, color: "#e8a317" },
    { key: "an.metric.circular", value: m.circular, icon: ShieldAlert, color: "#ff4a1f" },
    { key: "an.metric.external", value: m.externalLinks, icon: ShieldAlert, color: "#fb7185" },
    { key: "an.metric.merged", value: m.merged, icon: ShieldAlert, color: "#e8a317" },
    { key: "an.metric.hidden", value: m.hiddenSheets, icon: EyeOff, color: "#9c9ea3" },
    { key: "an.metric.hardcoded", value: m.hardcoded, icon: ShieldAlert, color: "#ff6a45" },
    { key: "an.metric.dupes", value: m.duplicateRows, icon: ShieldAlert, color: "#e8a317" },
    { key: "an.metric.errors", value: m.errorCells, icon: ShieldAlert, color: "#fb7185" },
    { key: "an.metric.names", value: m.names, icon: ShieldAlert, color: "#9c9ea3" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid lg:grid-cols-3 gap-4">
        {/* health */}
        <Panel glow className="p-5 flex items-center justify-center gap-6 scanline">
          <Donut
            value={m.healthScore}
            label={String(m.healthScore)}
            sub={t("an.health")}
            color={m.healthScore >= 75 ? "#5ecf9a" : m.healthScore >= 45 ? "#e8a317" : "#fb7185"}
          />
          <div className="space-y-3">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-dim">{t("an.riskscore")}</div>
              <div className="mono text-2xl font-bold text-hot">{m.riskScore}</div>
              <p className="text-[10px] text-dim leading-snug mt-1 max-w-[14rem]">{t("an.score.note")}</p>
            </div>
            <div className="space-y-1.5">
              {sevItems.map((s) => (
                <div key={s.label} className="flex items-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                  <span className="text-dim w-16">{s.label}</span>
                  <span className="mono font-semibold" style={{ color: s.color }}>
                    {s.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        {/* risk distribution */}
        <Panel className="p-5">
          <PanelTitle>{t("an.riskdist")}</PanelTitle>
          <HBars items={sevItems} />
          <div className="mt-5">
            <PanelTitle>{lang === "jp" ? "種別トップ" : "Top finding types"}</PanelTitle>
            <HBars
              items={topTypes.map((x, i) => ({ ...x, color: ["#ff4a1f", "#fb7185", "#e8a317", "#ff6a45", "#5ecf9a", "#9c9ea3"][i % 6] }))}
            />
          </div>
        </Panel>

        {/* files */}
        <Panel className="p-5">
          <PanelTitle>{t("an.files")}</PanelTitle>
          <div className="space-y-2.5">
            {res.files.map((f) => (
              <div key={f.id} className="rounded-xl border border-edge/70 bg-ink/60 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <FileSpreadsheet size={14} className="text-accent shrink-0" />
                  <span className="text-sm font-medium truncate">{f.name}</span>
                </div>
                <div className="mono text-[10px] text-dim flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>{fmtBytes(f.size)}</span>
                  {f.encoding && <span>{f.encoding}</span>}
                  <span>{f.sheets} sheets</span>
                  <span>{fmtNum(f.formulas)} fx</span>
                  <span>{fmtNum(f.cells)} cells</span>
                </div>
              </div>
            ))}
            {detail.mode === "local" && (
              <div className="text-[11px] text-ok/80 border border-ok/25 bg-ok/5 rounded-lg px-3 py-2">
                {lang === "jp"
                  ? "ローカルモード：原本のバイトはサーバーに存在しません（プライバシー保護）。"
                  : "Local mode: original bytes were never uploaded (privacy preserved)."}
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* metric tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        {metricTiles.map((x) => (
          <Panel key={x.key} className={`p-3.5 ${x.value > 0 && x.color !== "#9c9ea3" && x.color !== "#eff0f1" ? "border-l-2" : ""}`} style={x.value > 0 && x.color !== "#9c9ea3" && x.color !== "#eff0f1" ? { borderLeftColor: x.color } : undefined}>
            <div className="mono text-xl font-bold" style={{ color: x.value > 0 ? x.color : "#5b5c5e" }}>
              {fmtNum(x.value)}
            </div>
            <div className="text-[10px] text-dim mt-0.5">{t(x.key)}</div>
          </Panel>
        ))}
      </div>

      {/* role check packs */}
      <Panel className="p-5">
        <PanelTitle
          right={
            <span className="text-[10px] text-dim flex items-center gap-1">
              <ClipboardList size={12} />
              {t("pack.note")}
            </span>
          }
        >
          {t("pack.title")}
        </PanelTitle>
        <p className="text-xs text-dim mb-3">{t("pack.lead")}</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {CHECK_PACKS.map((pack) => {
            const summary = packSummaries.find((s) => s.packId === pack.id);
            const active = activePack === pack.id;
            return (
              <button
                key={pack.id}
                type="button"
                onClick={() => setActivePack(pack.id)}
                className={`btn text-[11px] !py-1.5 !px-3 ${active ? "btn-primary" : "btn-ghost"}`}
              >
                {t(pack.nameKey)}
                <span className="mono ml-1.5 opacity-80">{fmtNum(summary?.matchingRisks ?? 0)}</span>
              </button>
            );
          })}
        </div>
        {activeSummary && (
          <div className="rounded-xl border border-edge/70 bg-ink/40 p-4 space-y-3">
            <div>
              <div className="text-sm font-medium">{t(CHECK_PACKS.find((p) => p.id === activeSummary.packId)?.nameKey ?? "")}</div>
              <p className="text-xs text-dim mt-1">{t(CHECK_PACKS.find((p) => p.id === activeSummary.packId)?.descKey ?? "")}</p>
            </div>
            <div className="mono text-2xl font-bold text-accent">{fmtNum(activeSummary.matchingRisks)}</div>
            <div className="text-[10px] uppercase tracking-widest text-dim">{t("pack.matching")}</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(activeSummary.byType).map(([type, n]) => (
                <span key={type} className="chip text-[10px]">
                  {t(`risk.${type}`)} · {n}
                </span>
              ))}
              {!Object.keys(activeSummary.byType).length && (
                <span className="text-xs text-dim">{t("pack.empty")}</span>
              )}
            </div>
          </div>
        )}
      </Panel>

      {/* sheet inventory */}
      <Panel className="overflow-hidden">
        <PanelTitle>{t("an.sheets.title")}</PanelTitle>
        <div className="max-h-[380px] overflow-auto">
          <table className="table-x">
            <thead>
              <tr>
                <th>{t("an.col.sheet")}</th>
                <th>{t("an.col.vis")}</th>
                <th>{t("an.col.dim")}</th>
                <th className="text-right">{t("an.col.cells")}</th>
                <th className="text-right">{t("an.col.formulas")}</th>
                <th className="text-right">{t("an.col.errors")}</th>
                <th>{t("an.files")}</th>
              </tr>
            </thead>
            <tbody>
              {res.sheets.map((s, i) => (
                <tr key={i}>
                  <td className="font-medium mono text-xs">{s.name}</td>
                  <td>
                    {s.visibility === "visible" ? (
                      <SevBadge sev="info" label="visible" />
                    ) : (
                      <SevBadge sev={s.visibility === "veryHidden" ? "error" : "warning"} label={s.visibility === "veryHidden" ? "very hidden" : "hidden"} />
                    )}
                  </td>
                  <td className="mono text-xs text-dim">
                    {fmtNum(s.rows)} × {fmtNum(s.cols)}
                  </td>
                  <td className="mono text-xs text-right">{fmtNum(s.cells)}</td>
                  <td className="mono text-xs text-right text-accent">{fmtNum(s.formulas)}</td>
                  <td className={`mono text-xs text-right ${s.errors ? "text-hot" : "text-dim"}`}>{s.errors}</td>
                  <td className="mono text-[10px] text-dim">{s.file}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
