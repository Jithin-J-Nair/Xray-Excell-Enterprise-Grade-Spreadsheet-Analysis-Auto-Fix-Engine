"use client";
import { FileSpreadsheet, EyeOff, ShieldAlert, FileCode, Type } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { Donut, HBars } from "@/components/charts";
import { Panel, PanelTitle, SevBadge, fmtBytes, fmtNum } from "@/components/ui";
import type { AnalysisDetail } from "./shared";

export function OverviewTab({ detail }: { detail: AnalysisDetail }) {
  const { t, lang } = useI18n();
  const res = detail.result!;
  const m = res.metrics;

  const sevItems = (["critical", "error", "warning", "info"] as const).map((s) => ({
    label: t(`an.sev.${s}`),
    value: m.risksBySeverity[s],
    color: { critical: "#f472b6", error: "#fb7185", warning: "#fbbf24", info: "#38bdf8" }[s],
  }));

  const topTypes = Object.entries(res.riskCounts)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, 6)
    .map(([type, n]) => ({
      label: t(`risk.${type}`),
      value: n ?? 0,
      color: "#38bdf8",
    }));

  const metricTiles: { key: string; value: number; icon: typeof Type; color: string }[] = [
    { key: "an.metric.sheets", value: m.sheets, icon: FileSpreadsheet, color: "#38bdf8" },
    { key: "an.metric.cells", value: m.cells, icon: Type, color: "#7d90ad" },
    { key: "an.metric.formulas", value: m.formulas, icon: FileCode, color: "#22d3ee" },
    { key: "an.metric.volatile", value: m.volatile, icon: ShieldAlert, color: "#fbbf24" },
    { key: "an.metric.circular", value: m.circular, icon: ShieldAlert, color: "#f472b6" },
    { key: "an.metric.external", value: m.externalLinks, icon: ShieldAlert, color: "#fb7185" },
    { key: "an.metric.merged", value: m.merged, icon: ShieldAlert, color: "#fbbf24" },
    { key: "an.metric.hidden", value: m.hiddenSheets, icon: EyeOff, color: "#a78bfa" },
    { key: "an.metric.hardcoded", value: m.hardcoded, icon: ShieldAlert, color: "#38bdf8" },
    { key: "an.metric.dupes", value: m.duplicateRows, icon: ShieldAlert, color: "#fbbf24" },
    { key: "an.metric.errors", value: m.errorCells, icon: ShieldAlert, color: "#fb7185" },
    { key: "an.metric.names", value: m.names, icon: ShieldAlert, color: "#7d90ad" },
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
            color={m.healthScore >= 75 ? "#34d399" : m.healthScore >= 45 ? "#fbbf24" : "#fb7185"}
          />
          <div className="space-y-3">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-dim">{t("an.riskscore")}</div>
              <div className="mono text-2xl font-bold text-hot">{m.riskScore}</div>
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
              items={topTypes.map((x, i) => ({ ...x, color: ["#f472b6", "#fb7185", "#fbbf24", "#38bdf8", "#22d3ee", "#a78bfa"][i % 6] }))}
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
          <Panel key={x.key} className={`p-3.5 ${x.value > 0 && x.color !== "#7d90ad" && x.color !== "#38bdf8" ? "border-l-2" : ""}`}>
            <div className="mono text-xl font-bold" style={{ color: x.value > 0 ? x.color : "#4b5a75" }}>
              {fmtNum(x.value)}
            </div>
            <div className="text-[10px] text-dim mt-0.5">{t(x.key)}</div>
          </Panel>
        ))}
      </div>

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
