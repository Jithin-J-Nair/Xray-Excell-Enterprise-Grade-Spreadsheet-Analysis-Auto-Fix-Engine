"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { LayoutDashboard, GitFork, AlertOctagon, Grid3X3, Wrench, PackageCheck, RefreshCw, Trash2, ArrowLeft, Terminal } from "lucide-react";
import Link from "next/link";
import { useI18n } from "@/components/i18n";
import { ProgressBar, StatusChip, fmtNum } from "@/components/ui";
import type { AnalysisDetail, StatusPayload } from "@/components/analysis/shared";
import { OverviewTab } from "@/components/analysis/overview-tab";
import { GraphTab } from "@/components/analysis/graph-tab";
import { RisksTab } from "@/components/analysis/risks-tab";
import { SheetsTab } from "@/components/analysis/sheets-tab";
import { WorkbenchTab } from "@/components/analysis/workbench-tab";
import { ExportTab } from "@/components/analysis/export-tab";

const TABS = [
  { key: "overview", icon: LayoutDashboard, labelKey: "an.tabs.overview" },
  { key: "graph", icon: GitFork, labelKey: "an.tabs.graph" },
  { key: "risks", icon: AlertOctagon, labelKey: "an.tabs.risks" },
  { key: "sheets", icon: Grid3X3, labelKey: "an.tabs.sheets" },
  { key: "workbench", icon: Wrench, labelKey: "an.tabs.workbench" },
  { key: "export", icon: PackageCheck, labelKey: "an.tabs.export" },
] as const;

export default function AnalysisPage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [detail, setDetail] = useState<AnalysisDetail | null>(null);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [tab, setTab] = useState<string>("overview");
  const [notFound, setNotFound] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("tab");
    // This one-time URL-to-tab synchronization is an intentional state initializer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (q && TABS.some((x) => x.key === q)) setTab(q);
  }, []);

  const loadDetail = useCallback(async () => {
    const res = await fetch(`/api/analysis/${id}`);
    if (res.status === 404) {
      setNotFound(true);
      return;
    }
    const json = (await res.json()) as AnalysisDetail;
    setDetail(json);
    return json;
  }, [id]);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const res = await fetch(`/api/analysis/${id}/status`);
        if (res.status === 404) {
          if (!stop) setNotFound(true);
          return;
        }
        const s = (await res.json()) as StatusPayload;
        if (stop) return;
        setStatus(s);
        if (s.status === "completed" || s.status === "failed") {
          await loadDetail();
          if (s.status === "failed") timer = setTimeout(tick, 4000);
          return;
        }
        timer = setTimeout(tick, 900);
      } catch {
        timer = setTimeout(tick, 2000);
      }
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [id, loadDetail]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [status?.log?.length]);

  const reload = useCallback(() => loadDetail(), [loadDetail]);

  const del = async () => {
    if (!confirm("Delete this analysis?")) return;
    await fetch(`/api/analysis/${id}`, { method: "DELETE" });
    window.location.href = "/";
  };

  const scanning = !detail || detail.status === "processing" || detail.status === "queued";

  const riskTotal = useMemo(() => {
    if (!detail?.result) return 0;
    const r = detail.result.metrics.risksBySeverity;
    return r.critical + r.error + r.warning + r.info;
  }, [detail]);

  if (notFound) {
    return (
      <div className="max-w-xl mx-auto px-5 pt-24 text-center">
        <div className="text-4xl mono text-hot mb-4">404</div>
        <p className="text-dim mb-6">Analysis not found.</p>
        <Link href="/" className="btn btn-ghost">
          <ArrowLeft size={14} /> {t("nav.dashboard")}
        </Link>
      </div>
    );
  }

  if (scanning && detail?.status !== "failed") {
    const prog = status?.progress ?? detail?.progress ?? 3;
    return (
      <div className="relative">
        <div className="grid-bg absolute inset-x-0 top-0 h-[300px] pointer-events-none" />
        <div className="max-w-3xl mx-auto px-5 pt-16 relative">
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center gap-3 mb-2">
              <StatusChip status={status?.status ?? "queued"} t={t} />
              <span className="mono text-xs text-dim">{id.slice(0, 8)}</span>
            </div>
            <h1 className="text-2xl font-black tracking-tight mb-1 truncate">{detail?.name ?? status?.statusText ?? "…"}</h1>
            <p className="text-dim text-sm mb-8">{status?.statusText ?? t("up.scanning")}</p>
            <div className="mb-3 flex items-center justify-between mono text-xs text-dim">
              <span>{t("up.scanning")}</span>
              <span className="text-accent text-lg font-bold">{prog}%</span>
            </div>
            <ProgressBar value={prog} />
            <div className="panel mt-6 scanline">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-edge/60 text-dim">
                <Terminal size={13} />
                <span className="mono text-[10px] tracking-widest uppercase">engine log</span>
              </div>
              <div ref={logRef} className="mono text-[11px] leading-5 px-4 py-3 h-56 overflow-y-auto">
                {(status?.log ?? []).map((l, i) => (
                  <div key={i} className="flex gap-3">
                    <span className="text-dim/60 shrink-0">{new Date(l.t).toLocaleTimeString()}</span>
                    <span className="text-txt/90 whitespace-pre-wrap break-all">▸ {l.msg}</span>
                  </div>
                ))}
                <div className="text-accent pulse-dot mt-1">█</div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  if (!detail) return null;

  if (detail.status === "failed") {
    return (
      <div className="max-w-xl mx-auto px-5 pt-24 text-center">
        <div className="text-hot mono text-lg mb-3">ANALYSIS FAILED</div>
        <p className="text-dim text-sm mono mb-6">{detail.error}</p>
        <Link href="/analyze" className="btn btn-ghost">
          <ArrowLeft size={14} /> {t("nav.new")}
        </Link>
      </div>
    );
  }

  const res = detail.result!;

  return (
    <div className="max-w-[1400px] mx-auto px-5 pt-6 pb-16">
      {/* header */}
      <div className="flex flex-wrap items-start gap-4 mb-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5 mb-1.5">
            <StatusChip status={detail.status} t={t} />
            {detail.mode === "local" && (
              <span className="chip text-ok border-ok/40 bg-ok/10">local · private</span>
            )}
            <span className="mono text-[10px] text-dim">{detail.id.slice(0, 8)} · {detail.sourceFiles.map((f) => f.name).join(", ") || detail.name}</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-black tracking-tight truncate">{detail.name}</h1>
          <div className="mono text-xs text-dim mt-1">
            {fmtNum(res.metrics.cells)} cells · {fmtNum(res.metrics.formulas)} formulas · {riskTotal} findings · health{" "}
            <span className={res.metrics.healthScore >= 75 ? "text-ok" : res.metrics.healthScore >= 45 ? "text-warn" : "text-hot"}>
              {res.metrics.healthScore}
            </span>
            /100
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={reload} className="btn btn-ghost text-xs" title="Refresh">
            <RefreshCw size={13} />
          </button>
          <button onClick={del} className="btn btn-danger text-xs" title="Delete">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* tabs */}
      <div className="flex gap-1 border-b border-edge/70 mb-6 overflow-x-auto">
        {TABS.map((tb) => {
          const active = tab === tb.key;
          const count = tb.key === "risks" ? riskTotal : undefined;
          return (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm whitespace-nowrap transition-colors ${
                active ? "text-accent" : "text-dim hover:text-txt"
              }`}
            >
              <tb.icon size={14} />
              {t(tb.labelKey)}
              {count !== undefined && (
                <span className={`mono text-[10px] rounded-full px-1.5 py-0.5 ${active ? "bg-accent/15" : "bg-edge/60"}`}>{count}</span>
              )}
              {active && <motion.span layoutId="tabline" className="absolute inset-x-2 -bottom-px h-0.5 bg-accent rounded-full" />}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }}>
          {tab === "overview" && <OverviewTab detail={detail} />}
          {tab === "graph" && <GraphTab detail={detail} />}
          {tab === "risks" && <RisksTab detail={detail} />}
          {tab === "sheets" && <SheetsTab detail={detail} />}
          {tab === "workbench" && <WorkbenchTab detail={detail} reload={reload} />}
          {tab === "export" && <ExportTab detail={detail} reload={reload} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
