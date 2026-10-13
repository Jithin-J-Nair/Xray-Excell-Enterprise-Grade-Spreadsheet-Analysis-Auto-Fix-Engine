"use client";
import { useEffect, useState } from "react";
import { Download, Undo2, PackageCheck, ScrollText, Loader2, FileJson, ShieldCheck } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { Panel, PanelTitle, StatusChip, fmtBytes, relTime } from "@/components/ui";
import { toast } from "@/components/toast";
import { downloadOutput } from "@/lib/download";
import type { AnalysisDetail, JobRow } from "./shared";

export function ExportTab({ detail, reload }: { detail: AnalysisDetail; reload: () => void }) {
  const { t, lang } = useI18n();
  const [undoing, setUndoing] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const dl = async (fileId: string, name: string) => {
    if (downloading) return;
    setDownloading(fileId);
    try {
      await downloadOutput(fileId, name);
      toast(name, "ok");
    } catch {
      /* toast shown by helper */
    } finally {
      setDownloading(null);
    }
  };

  const anyRunning = detail.jobs.some((j) => j.status === "running" || j.status === "queued");
  useEffect(() => {
    if (!anyRunning) return;
    const iv = setInterval(reload, 1500);
    return () => clearInterval(iv);
  }, [anyRunning, reload]);

  const undo = async (job: JobRow) => {
    setUndoing(job.id);
    setErr(null);
    try {
      const r = await fetch(`/api/undo/${job.id}`, { method: "POST" });
      const json = await r.json();
      if (!r.ok) throw new Error(json.message ?? "undo failed");
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUndoing(null);
    }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="space-y-4">
        <Panel>
          <PanelTitle right={anyRunning && <Loader2 size={13} className="animate-spin text-accent" />}>{t("ex.jobs")}</PanelTitle>
          {err && <div className="mx-4 mb-3 text-hot text-xs mono border border-hot/40 bg-hot/10 rounded-lg px-3 py-2">{err}</div>}
          <div className="px-4 pb-4 space-y-3">
            {detail.jobs.filter((j) => j.kind === "apply").length === 0 && (
              <div className="text-center text-dim text-sm py-10">
                <PackageCheck size={24} className="mx-auto mb-3 opacity-40" />
                {t("ex.none")}
              </div>
            )}
            {detail.jobs
              .filter((j) => j.kind === "apply")
              .map((j) => {
                const summary = j.summary as { cellsChanged?: number; formulasChanged?: number; rowsRemoved?: number; riskScoreBefore?: number; riskScoreAfter?: number; byTool?: Record<string, number>; tools?: string[] };
                const tools = Object.keys(summary?.byTool ?? {});
                return (
                  <div key={j.id} className={`rounded-xl border p-3.5 ${j.reverted ? "border-warn/30 bg-warn/[0.04]" : "border-edge/70 bg-ink/50"}`}>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <StatusChip status={j.status} t={t} />
                        {j.reverted && <span className="chip text-warn border-warn/40 bg-warn/10">{t("ex.undone")}</span>}
                        {detail.mode === "local" && <span className="chip text-ok border-ok/30 bg-ok/10">local</span>}
                      </div>
                      <span className="mono text-[10px] text-dim">{relTime(j.createdAt, lang)}</span>
                    </div>
                    {tools.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {tools.map((tool) => (
                          <span key={tool} className="mono text-[9px] px-1.5 py-0.5 rounded border border-edge2 text-dim">
                            {tool}
                          </span>
                        ))}
                      </div>
                    )}
                    {summary && j.status === "completed" && (
                      <div className="mono text-[10px] text-dim mb-2.5 flex flex-wrap gap-x-3">
                        {summary.cellsChanged != null && <span>Δcells {summary.cellsChanged}</span>}
                        {summary.formulasChanged != null && <span>Δfx {summary.formulasChanged}</span>}
                        {summary.rowsRemoved ? <span>-{summary.rowsRemoved} rows</span> : null}
                        {summary.riskScoreBefore != null && (
                          <span className="text-ok">
                            risk {summary.riskScoreBefore}→{summary.riskScoreAfter}
                          </span>
                        )}
                      </div>
                    )}
                    {(j.outputs?.length ?? 0) > 0 && (
                      <div className="space-y-1.5 mb-2">
                        {j.outputs.map((o) => (
                          <div key={o.fileId} className="flex items-center justify-between gap-2 rounded-lg border border-edge/50 bg-void/60 px-2.5 py-1.5">
                            <div className="min-w-0 flex items-center gap-2">
                              <FileJson size={12} className="text-dim shrink-0" />
                              <span className="text-[11px] mono truncate">{o.name}</span>
                              <span className="text-[9px] text-dim mono shrink-0">{fmtBytes(o.size)}</span>
                            </div>
                            <button
                              onClick={() => dl(o.fileId, o.name)}
                              disabled={downloading === o.fileId}
                              className="btn btn-ghost !py-0.5 !px-2 text-[10px] shrink-0"
                              aria-label={`Download ${o.name}`}
                            >
                              {downloading === o.fileId ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      {j.patchFileId && (
                        <button
                          onClick={() => dl(j.patchFileId!, `patch_${j.id.slice(0, 8)}.json`)}
                          disabled={downloading === j.patchFileId}
                          className="text-[10px] text-accent hover:underline mono flex items-center gap-1"
                        >
                          <ScrollText size={10} />
                          {t("ex.patch")} (reversible)
                        </button>
                      )}
                      {j.reverted && j.undoFileId && (
                        <button
                          onClick={() => dl(j.undoFileId!, "reverted.xlsx")}
                          disabled={downloading === j.undoFileId}
                          className="text-[10px] text-warn hover:underline mono"
                        >
                          ↓ reverted original
                        </button>
                      )}
                      {j.status === "completed" && !j.reverted && (
                        <button
                          onClick={() => undo(j)}
                          disabled={undoing === j.id}
                          className="ml-auto btn btn-danger !py-1 !px-2.5 text-[10px]"
                        >
                          {undoing === j.id ? <Loader2 size={11} className="animate-spin" /> : <Undo2 size={11} />}
                          {t("ex.undo")}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel>
          <PanelTitle>{t("ex.audit")}</PanelTitle>
          <div className="px-4 pb-4 space-y-0 max-h-[560px] overflow-y-auto">
            {detail.audit.map((a, i) => (
              <div key={a.id} className="flex gap-3 py-2 border-b border-edge/40 last:border-0">
                <div className="flex flex-col items-center mt-1">
                  <span className="w-2 h-2 rounded-full bg-accent/70" />
                  {i < detail.audit.length - 1 && <span className="w-px flex-1 bg-edge/60 mt-1" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="mono text-[11px] text-accent">{a.action}</span>
                    <span className="mono text-[9.5px] text-dim">{relTime(a.at, lang)}</span>
                  </div>
                  <div className="mono text-[10px] text-dim break-all mt-0.5 leading-relaxed">
                    {JSON.stringify(a.detail)}
                  </div>
                </div>
              </div>
            ))}
            {!detail.audit.length && <div className="text-center text-dim text-sm py-10">{t("common.empty")}</div>}
          </div>
        </Panel>
        <Panel className="p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck size={18} className="text-ok mt-0.5 shrink-0" />
            <div className="text-xs text-dim leading-relaxed">
              <span className="text-txt font-semibold">Deterministic guarantee.</span>{" "}
              {lang === "jp"
                ? "すべての適用はコピーに対して実行され、逆パッチが自動生成されます。undo は原本のバイトから完全に復元します。データは一切失われません。"
                : "Every apply writes to a copy and auto-generates a reverse patch. Undo restores byte-identical originals from the immutable upload. No silent data loss, ever."}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
