"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ScanSearch,
  FileSpreadsheet,
  AlertTriangle,
  Sigma,
  Wrench,
  Gauge,
  Database,
  ArrowRight,
  Activity,
  ShieldCheck,
  Beaker,
  Eye,
} from "lucide-react";
import { useI18n } from "@/components/i18n";
import { Panel, PanelTitle, StatusChip, fmtBytes, fmtNum, relTime } from "@/components/ui";
import { useRouter } from "next/navigation";

interface Recent {
  id: string;
  name: string;
  status: string;
  progress: number;
  mode: string;
  createdAt: string;
  riskScore: number | null;
  healthScore: number | null;
  riskCount: number | null;
  formulaCount: number | null;
}

interface Dash {
  stats: {
    totalAnalyses: number;
    completed: number;
    avgHealth: number | null;
    totalRisks: number;
    totalFormulas: number;
    applied: number;
    uploadsCount: number;
    exportsCount: number;
    bytesProcessed: number;
  };
  recent: Recent[];
  audits: { id: string; action: string; detail: unknown; at: string }[];
  notice?: string;
}

function healthColor(h: number | null): string {
  if (h === null) return "#38bdf8";
  if (h >= 75) return "#34d399";
  if (h >= 45) return "#fbbf24";
  return "#fb7185";
}

export default function Dashboard() {
  const { t, lang } = useI18n();
  const [data, setData] = useState<Dash | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();

  const load = () => fetch("/api/dashboard").then((r) => r.json()).then(setData).catch(() => {});
  useEffect(() => {
    load();
    const iv = setInterval(load, 6000);
    return () => clearInterval(iv);
  }, []);

  const genSample = async (kind: string) => {
    setBusy(kind);
    try {
      const res = await fetch("/api/samples", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "sample failed");
      const res2 = await fetch("/api/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: json.uploadId, options: { resolveCrossFile: true, language: lang } }),
      });
      const json2 = await res2.json();
      router.push(`/analysis/${json2.analysisId}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const statCards = [
    { icon: FileSpreadsheet, label: t("dash.stat.analyses"), value: fmtNum(data?.stats.totalAnalyses ?? 0), color: "#38bdf8" },
    { icon: AlertTriangle, label: t("dash.stat.risks"), value: fmtNum(data?.stats.totalRisks ?? 0), color: "#fb7185" },
    { icon: Sigma, label: t("dash.stat.formulas"), value: fmtNum(data?.stats.totalFormulas ?? 0), color: "#22d3ee" },
    { icon: Wrench, label: t("dash.stat.fixes"), value: fmtNum(data?.stats.applied ?? 0), color: "#34d399" },
    { icon: Gauge, label: t("dash.stat.health"), value: data?.stats.avgHealth != null ? `${data.stats.avgHealth}` : "—", color: "#fbbf24" },
    { icon: Database, label: t("dash.stat.bytes"), value: fmtBytes(data?.stats.bytesProcessed ?? 0), color: "#a78bfa" },
  ];

  return (
    <div className="relative">
      <div className="grid-bg absolute inset-x-0 top-0 h-[420px] pointer-events-none" />
      <div className="max-w-[1400px] mx-auto px-5 pt-14 pb-16 relative">
        {/* hero */}
        <motion.section initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="text-center mb-12">
          <div className="inline-flex items-center gap-2 mono text-[10px] tracking-[0.25em] text-accent border border-accent/30 bg-accent/5 rounded-full px-4 py-1.5 mb-6">
            <ScanSearch size={12} />
            STATIC ANALYSIS · DEPENDENCY GRAPH · DETERMINISTIC REPAIR
          </div>
          <h1 className="text-4xl md:text-6xl font-black tracking-tight mb-4">
            {lang === "jp" ? (
              t("dash.hero.title")
            ) : (
              <>
                See <span className="text-accent glow-text">through</span> your spreadsheets.
              </>
            )}
          </h1>
          <p className="text-dim max-w-2xl mx-auto text-sm md:text-base leading-relaxed">{t("dash.hero.sub")}</p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
            <Link href="/analyze" className="btn btn-primary">
              <ScanSearch size={16} />
              {t("dash.cta.scan")}
            </Link>
            <button onClick={() => genSample("monster")} disabled={busy !== null} className="btn btn-ghost">
              <Beaker size={15} />
              {busy === "monster" ? t("up.scanning") : t("dash.cta.monster")}
            </button>
            <button onClick={() => genSample("jp")} disabled={busy !== null} className="btn btn-ghost">
              <Beaker size={15} />
              {busy === "jp" ? t("up.scanning") : t("dash.cta.jp")}
            </button>
          </div>
        </motion.section>

        {/* stat grid */}
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.15 }}
          className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-8"
        >
          {statCards.map((s) => (
            <Panel key={s.label} className="p-4 scanline">
              <s.icon size={16} style={{ color: s.color }} className="mb-2.5" />
              <div className="mono text-2xl font-bold" style={{ color: s.color }}>
                {s.value}
              </div>
              <div className="text-[11px] text-dim mt-0.5">{s.label}</div>
            </Panel>
          ))}
        </motion.section>

        <div className="grid lg:grid-cols-3 gap-4">
          {/* recent analyses */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="lg:col-span-2">
            <Panel className="overflow-hidden">
              <PanelTitle right={<Activity size={14} className="text-dim" />}>{t("dash.recent")}</PanelTitle>
              {data?.recent.length ? (
                <div className="divide-y divide-edge/50">
                  {data.recent.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => router.push(`/analysis/${r.id}`)}
                      className="w-full text-left px-4 py-3 hover:bg-accent/5 transition-colors flex items-center gap-4 group"
                    >
                      <div
                        className="w-10 h-10 rounded-lg border flex items-center justify-center mono text-xs font-bold shrink-0"
                        style={{ borderColor: `${healthColor(r.healthScore)}44`, color: healthColor(r.healthScore), background: `${healthColor(r.healthScore)}0d` }}
                      >
                        {r.healthScore ?? "--"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate group-hover:text-accent transition-colors">{r.name}</div>
                        <div className="text-[11px] text-dim mono truncate">
                          {relTime(r.createdAt, lang)} · {r.mode === "local" ? (lang === "jp" ? "ローカル" : "local") : "server"}
                          {r.formulaCount != null && ` · ${fmtNum(r.formulaCount)} fx`}
                          {r.riskCount != null && r.riskCount > 0 && ` · ${r.riskCount} risks`}
                        </div>
                      </div>
                      <StatusChip status={r.status} t={t} />
                      <ArrowRight size={14} className="text-dim group-hover:text-accent transition-colors" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-14 text-center text-dim text-sm">
                  <Eye size={22} className="mx-auto mb-3 opacity-50" />
                  {t("dash.recent.empty")}
                </div>
              )}
            </Panel>
          </motion.div>

          {/* activity + policy */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="space-y-4">
            <Panel>
              <PanelTitle>{t("dash.activity")}</PanelTitle>
              <div className="px-4 pb-4 space-y-2 max-h-[280px] overflow-y-auto">
                {data?.audits.length ? (
                  data.audits.map((a) => (
                    <div key={a.id} className="flex items-start gap-2 text-[11px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent/70 mt-1.5 shrink-0" />
                      <div className="min-w-0">
                        <span className="mono text-accent">{a.action}</span>
                        <span className="text-dim ml-2">{relTime(a.at, lang)}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-dim text-xs py-4 text-center">{t("common.empty")}</div>
                )}
              </div>
            </Panel>
            <Panel className="p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck size={18} className="text-ok mt-0.5 shrink-0" />
                <div>
                  <div className="text-sm font-semibold mb-1">{t("dash.local.title")}</div>
                  <div className="text-xs text-dim leading-relaxed">{t("dash.local.desc")}</div>
                </div>
              </div>
            </Panel>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
