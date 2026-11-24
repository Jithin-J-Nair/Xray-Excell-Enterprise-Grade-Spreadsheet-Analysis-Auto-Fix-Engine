"use client";

import { BookLock, ShieldCheck, Wand2, CheckCircle2, AlertTriangle } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { Panel, PanelTitle } from "@/components/ui";

export interface RuleRow {
  id: string;
  group: string;
  name: string;
  description: string;
  safeDefault: boolean;
  autoFix: boolean;
  targets: string[];
}

const GROUP_COLOR: Record<string, string> = {
  organize: "#ff6a45",
  clean: "#5ecf9a",
  mitigate: "#fb7185",
  custom: "#9c9ea3",
};

export function SettingsView({
  initialRules,
  initialAutofix,
}: {
  initialRules: RuleRow[];
  initialAutofix: string[];
}) {
  const { t } = useI18n();
  const rules = initialRules;
  const autofix = initialAutofix;

  return (
    <div className="app-shell">
      <div className="flex items-center gap-3 mb-3">
        <BookLock size={20} className="text-accent" />
        <h1 className="text-2xl md:text-3xl font-medium tracking-tight" style={{ letterSpacing: "var(--display-tracking)" }}>
          {t("settings.title")}
        </h1>
      </div>
      <p className="text-dim text-base mb-10 max-w-2xl leading-relaxed">{t("settings.sub")}</p>

      <Panel className="overflow-hidden mb-6">
        <div className="max-h-[480px] overflow-auto">
          <table className="table-x">
            <thead>
              <tr>
                <th className="w-16">{t("settings.col.id")}</th>
                <th className="w-24">{t("settings.col.group")}</th>
                <th className="w-56">{t("settings.col.name")}</th>
                <th>{t("settings.col.desc")}</th>
                <th className="w-32">{t("settings.col.safety")}</th>
                <th className="w-24">{t("wb.autofix")}</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => {
                const tone = GROUP_COLOR[r.group] ?? "#9c9ea3";
                return (
                  <tr key={r.id}>
                    <td className="mono text-[11px] text-accent">{r.id}</td>
                    <td>
                      <span className="chip" style={{ color: tone, borderColor: `${tone}55`, background: `${tone}11` }}>
                        {r.group}
                      </span>
                    </td>
                    <td className="text-xs font-medium">{t(`tool.${r.id}.name`) === `tool.${r.id}.name` ? r.name : t(`tool.${r.id}.name`)}</td>
                    <td className="text-[11.5px] text-dim leading-relaxed">
                      {t(`tool.${r.id}.desc`) === `tool.${r.id}.desc` ? r.description : t(`tool.${r.id}.desc`)}
                    </td>
                    <td>
                      {r.safeDefault ? (
                        <span className="chip text-ok border-ok/35 bg-ok/10">
                          <CheckCircle2 size={10} />
                          {t("settings.safe")}
                        </span>
                      ) : (
                        <span className="chip text-warn border-warn/35 bg-warn/10">{t("settings.review")}</span>
                      )}
                    </td>
                    <td className="mono text-[10px]">{autofix.includes(r.id) ? <Wand2 size={12} className="text-accent inline" /> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel className="mb-6 p-4">
        <PanelTitle>{t("settings.custom")}</PanelTitle>
        <div className="px-1 pb-1 flex items-start gap-2 text-xs text-dim leading-relaxed">
          <AlertTriangle size={14} className="text-warn shrink-0 mt-0.5" />
          <span>{t("settings.custom.note")}</span>
        </div>
      </Panel>

      <Panel className="mt-6 p-5">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck size={15} className="text-ok" />
          <span className="text-[11px] uppercase tracking-[0.15em] font-semibold text-dim">{t("settings.policies")}</span>
        </div>
        <ul className="text-xs text-dim space-y-2 leading-relaxed list-disc pl-4">
          <li>{t("settings.policy.retention")}</li>
          <li>{t("settings.policy.guard")}</li>
          <li>{t("settings.policy.det")}</li>
        </ul>
      </Panel>
    </div>
  );
}
