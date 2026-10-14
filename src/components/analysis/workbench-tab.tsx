"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Wand2, Play, Download, Loader2, Layers, Sparkles, ChevronRight, PackageCheck, ShieldCheck, Ban } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { Panel, PanelTitle, Switch, fmtBytes, fmtNum } from "@/components/ui";
import { toast } from "@/components/toast";
import { downloadOutput, saveBlob } from "@/lib/download";
import type { AnalysisDetail } from "./shared";
import { TOOLS, AUTOFIX_TOOLS } from "@/lib/excel/transform";
import { autoFixSelection, computeToolStates, enabledToolIds, reconcile, toggleTool, type ToolState } from "@/lib/excel/tool-state";
import type { Diff } from "@/lib/excel/types";

interface PreviewState {
  previewId: string;
  tools: string[];
  diffs: Diff[];
  summary: {
    cellsChanged: number;
    formulasChanged: number;
    rowsRemoved: number;
    namesFixed: number;
    mergesRemoved: number;
    riskScoreBefore: number;
    riskScoreAfter: number;
    risksResolved: number;
    byTool: Record<string, number>;
    sheetsAdded: string[];
  };
}

const FORMATS = [
  { id: "xlsx", label: ".xlsx", desc: "fixed workbook (formulas preserved)" },
  { id: "csv", label: ".csv", desc: "UTF-8 + BOM, primary sheet" },
  { id: "json", label: ".json", desc: "header-aware objects" },
  { id: "ndjson", label: ".ndjson", desc: "streaming rows" },
  { id: "md", label: ".md", desc: "localized audit report" },
];

export function WorkbenchTab({ detail, reload }: { detail: AnalysisDetail; reload: () => void }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const res = detail.result!;
  const isLocal = detail.mode === "local";
  const hasMacroInput = res.files.some((file) => /\.xlsm$/i.test(file.name));
  const xlsxDisabled = hasMacroInput || Boolean(res.model.styleMetadataUnavailable) || Boolean(res.model.unsupportedFeatures?.length);

  // ── tool toggle state machine ────────────────────────────────────────────
  const findingsByTool = useMemo(() => {
    const m = new Map<string, number>();
    const counts = res.riskCounts ?? {};
    for (const tool of TOOLS) {
      let n = 0;
      for (const target of tool.targets) n += counts[target] ?? 0;
      m.set(tool.id, n);
    }
    return m;
  }, [res.riskCounts]);

  const [toolStates, setToolStates] = useState<ToolState[]>(() => computeToolStates(findingsByTool));
  useEffect(() => {
    // Preserve user toggles while reconciling availability when findings change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToolStates((prev) => reconcile(prev, findingsByTool));
  }, [findingsByTool]);

  const selectedIds = useMemo(() => enabledToolIds(toolStates), [toolStates]);

  const [minOcc, setMinOcc] = useState(3);
  const [formats, setFormats] = useState<Set<string>>(
    () => new Set(xlsxDisabled ? ["csv", "md"] : ["xlsx", "csv", "md"])
  );
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [busyPreview, setBusyPreview] = useState(false);
  const [applyJob, setApplyJob] = useState<string | null>(null);
  const [applyDone, setApplyDone] = useState<{ outputs: { format: string; fileId: string; name: string; size: number }[]; summary: unknown } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filterTool, setFilterTool] = useState<string>("all");
  const [diffFilter, setDiffFilter] = useState<string>("");
  const [downloading, setDownloading] = useState<string | null>(null);

  const groups = useMemo(
    () => [
      { key: "organize", label: t("wb.group.organize"), color: "#38bdf8" },
      { key: "clean", label: t("wb.group.clean"), color: "#34d399" },
      { key: "mitigate", label: t("wb.group.mitigate"), color: "#f472b6" },
    ],
    [t]
  );

  const onToggle = (id: string) => {
    setPreview(null);
    setApplyDone(null);
    setToolStates((prev) => toggleTool(prev, id));
  };
  const onAutoFix = () => {
    setPreview(null);
    setApplyDone(null);
    setToolStates((prev) => autoFixSelection(prev));
  };

  const runPreview = useCallback(async () => {
    const tools = enabledToolIds(toolStates);
    setBusyPreview(true);
    setErr(null);
    setApplyDone(null);
    try {
      if (isLocal) {
        const { applyTransforms } = await import("@/lib/excel/transform");
        const { allModels, rescoreModel } = await import("@/lib/excel/analyze");
        const models = allModels(res);
        const before = rescoreModel(models[0], { language: lang });
        const { models: patched, diffs, summary } = applyTransforms(models, tools, { minOccurrences: minOcc });
        summary.riskScoreBefore = before;
        summary.riskScoreAfter = rescoreModel(patched[0], { language: lang });
        summary.risksResolved = Math.max(0, summary.riskScoreBefore - summary.riskScoreAfter);
        setPreview({ previewId: `local-${Date.now()}`, tools, diffs, summary });
      } else {
        const resp = await fetch(`/api/analysis/${detail.id}/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tools, options: { minOccurrences: minOcc } }),
        });
        const json = await resp.json();
        if (!resp.ok) throw new Error(json.message ?? "preview failed");
        setPreview({ previewId: json.previewId, tools, diffs: json.diffs, summary: json.summary });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyPreview(false);
    }
  }, [toolStates, minOcc, detail.id, isLocal, res, lang]);

  // poll apply job
  useEffect(() => {
    if (!applyJob) return;
    let stop = false;
    const iv = setInterval(async () => {
      try {
        const r = await fetch(`/api/jobs/${applyJob}`);
        const j = await r.json();
        if (stop) return;
        if (j.status === "completed" || j.status === "failed") {
          clearInterval(iv);
          if (j.status === "failed") {
            setErr(j.error ?? "apply failed");
            toast(`APPLY_FAILED: ${j.error ?? ""}`, "error");
          } else setApplyDone({ outputs: j.outputs ?? [], summary: j.summary });
          setApplyJob(null);
          reload();
        }
      } catch {
        /* keep polling */
      }
    }, 900);
    return () => {
      stop = true;
      clearInterval(iv);
    };
  }, [applyJob, reload]);

  const handleDownload = async (fileId: string, name: string) => {
    if (downloading) return;
    setDownloading(fileId);
    try {
      await downloadOutput(fileId, name);
      toast(name, "ok");
    } catch {
      /* toast already shown */
    } finally {
      setDownloading(null);
    }
  };

  const applyLocal = async () => {
    if (!preview) return;
    setErr(null);
    try {
      const { applyTransforms } = await import("@/lib/excel/transform");
      const { allModels } = await import("@/lib/excel/analyze");
      const { workbookToXlsxBytes, sheetToCsv, modelToJson, modelToNdjson, buildMarkdownReport } = await import("@/lib/excel/serialize");
      const models = allModels(res);
      const { models: patched, summary } = applyTransforms(models, preview.tools, { minOccurrences: minOcc });
      const unsafeXlsxModel = patched.find((model) => model.macroEnabled || model.styleMetadataUnavailable);
      if (formats.has("xlsx") && unsafeXlsxModel) {
        throw new Error(
          unsafeXlsxModel.macroEnabled
            ? `MACROS_UNSUPPORTED: ${unsafeXlsxModel.fileName} is macro-enabled; XLSX export would discard VBA.`
            : `STYLE_METADATA_UNAVAILABLE: ${unsafeXlsxModel.fileName} could not be read with reliable style metadata.`
        );
      }
      const main = patched[0];
      const base = (res.files[0]?.name ?? "workbook").replace(/\.[^.]+$/, "");
      const ts = new Date().toISOString().slice(0, 10).replaceAll("-", "");
      const done: { format: string; fileId: string; name: string; size: number }[] = [];
      if (formats.has("xlsx")) {
        // Match server mode: produce one XLSX per uploaded workbook, not only
        // the first model in a multi-file local analysis.
        for (const model of patched) {
          const modelBase = (model.fileName || base).replace(/\.[^.]+$/, "");
          const bytes = workbookToXlsxBytes(model);
          const name = `fixed_${modelBase}_${ts}.xlsx`;
          saveBlob(bytes, name, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
          done.push({ format: "xlsx", fileId: "local", name, size: bytes.length });
        }
      }
      if (formats.has("csv")) {
        const sheet = [...main.sheets].sort((a, b) => Object.keys(b.cells).length - Object.keys(a.cells).length)[0];
        const csv = sheetToCsv(sheet);
        const name = `${base}_${sheet.name}_${ts}.csv`;
        saveBlob(new TextEncoder().encode(csv), name, "text/csv; charset=utf-8");
        done.push({ format: "csv", fileId: "local", name, size: new TextEncoder().encode(csv).byteLength });
      }
      if (formats.has("json")) {
        const json = modelToJson(main);
        const name = `${base}_${ts}.json`;
        saveBlob(new TextEncoder().encode(json), name, "application/json");
        done.push({ format: "json", fileId: "local", name, size: new TextEncoder().encode(json).byteLength });
      }
      if (formats.has("ndjson")) {
        const nd = modelToNdjson(main);
        const name = `${base}_${ts}.ndjson`;
        saveBlob(new TextEncoder().encode(nd), name, "application/x-ndjson");
        done.push({ format: "ndjson", fileId: "local", name, size: new TextEncoder().encode(nd).byteLength });
      }
      if (formats.has("md")) {
        const md = buildMarkdownReport({
          analysis: res,
          toolsApplied: preview.tools.map((idm) => ({ id: idm, name: TOOLS.find((x) => x.id === idm)?.name ?? idm })),
          summary: summary as unknown as Record<string, unknown>,
          language: lang,
        });
        const name = `report_${base}_${ts}.md`;
        saveBlob(new TextEncoder().encode(md), name, "text/markdown");
        done.push({ format: "md", fileId: "local", name, size: new TextEncoder().encode(md).byteLength });
      }
      await fetch(`/api/analysis/${detail.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ localRecord: true, tools: preview.tools, summary, exportFormats: [...formats], language: lang }),
      });
      setApplyDone({ outputs: done, summary });
      toast(`${done.length} export(s) saved locally`, "ok");
      reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      toast(msg, "error");
    }
  };

  const apply = async () => {
    if (!preview) return;
    setErr(null);
    if (isLocal) {
      await applyLocal();
      return;
    }
    try {
      const resp = await fetch(`/api/analysis/${detail.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previewId: preview.previewId, exportFormats: [...formats] }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.message ?? "apply failed");
      setApplyJob(json.jobId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      toast(msg, "error");
    }
  };

  const filteredDiffs = useMemo(() => {
    if (!preview) return [];
    return preview.diffs
      .filter((d) => (filterTool === "all" ? true : d.ruleId === filterTool))
      .filter((d) => {
        if (!diffFilter.trim()) return true;
        const q = diffFilter.toLowerCase();
        return (
          d.sheet.toLowerCase().includes(q) ||
          d.cell.toLowerCase().includes(q) ||
          String(d.before ?? "").toLowerCase().includes(q) ||
          String(d.after ?? "").toLowerCase().includes(q)
        );
      });
  }, [preview, filterTool, diffFilter]);

  return (
    <div className="grid xl:grid-cols-12 gap-4">
      {/* tools */}
      <div className="xl:col-span-3 space-y-4">
        <Panel>
          <PanelTitle
            right={
              <button onClick={onAutoFix} className="btn btn-ghost !py-1 !px-2.5 text-[10.5px]" title={t("wb.autofix")}>
                <Wand2 size={12} />
                Auto-Fix
              </button>
            }
          >
            {t("wb.tools")}
          </PanelTitle>
          <div className="px-3 pb-3 space-y-3 max-h-[520px] overflow-y-auto">
            {groups.map((g) => (
              <div key={g.key}>
                <div className="text-[10px] uppercase tracking-[0.15em] px-1.5 mb-1.5 font-semibold" style={{ color: g.color }}>
                  {g.label}
                </div>
                <div className="space-y-1">
                  {toolStates
                    .filter((s) => s.def.group === g.key)
                    .map((s) => (
                      <div
                        key={s.id}
                        role="button"
                        tabIndex={s.available ? 0 : -1}
                        aria-disabled={!s.available}
                        onClick={() => onToggle(s.id)}
                        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onToggle(s.id)}
                        className={`w-full text-left rounded-lg border px-2.5 py-2 transition-colors ${
                          !s.available
                            ? "border-edge/40 bg-ink/20 opacity-50 cursor-not-allowed"
                            : s.enabled
                              ? "border-accent/40 bg-accent/[0.07] cursor-pointer"
                              : "border-edge/60 hover:border-edge2 bg-ink/40 cursor-pointer"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="mono text-[9px] text-dim shrink-0">{s.id}</span>
                            <span className="text-xs font-medium truncate">{s.def.name}</span>
                          </div>
                          <span onClick={(e) => e.stopPropagation()}>
                            <Switch checked={s.enabled} onChange={() => onToggle(s.id)} disabled={!s.available} />
                          </span>
                        </div>
                        <div className="text-[10.5px] text-dim mt-1 leading-relaxed">{s.def.desc}</div>
                        <div className="flex items-center gap-2 mt-1">
                          {s.available ? (
                            <span className="mono text-[9px] text-warn">{s.findings} findings</span>
                          ) : (
                            <span className="mono text-[9px] text-dim flex items-center gap-1">
                              <Ban size={9} /> no findings
                            </span>
                          )}
                          {s.defaultOn && <span className="mono text-[9px] text-ok/80">safe</span>}
                          {preview && s.enabled && (
                            <span className="mono text-[9px] text-accent">
                              {(preview.summary.byTool[s.id] ?? 0) > 0 ? `${preview.summary.byTool[s.id]} changes` : "0 changes"}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
          <div className="px-4 py-3 border-t border-edge/60">
            <div className="flex items-center justify-between text-[10.5px] text-dim mb-2">
              <span>
                {t("wb.advanced")} · T001 {t("wb.advanced.minOcc")}
              </span>
              <input
                type="number"
                min={2}
                max={50}
                value={minOcc}
                onChange={(e) => {
                  setPreview(null);
                  setApplyDone(null);
                  setMinOcc(Math.max(2, Math.min(50, Number(e.target.value) || 3)));
                }}
                className="w-16 !py-1 !px-2 text-xs text-right"
              />
            </div>
            <button onClick={runPreview} disabled={busyPreview || !selectedIds.length} className="btn btn-primary w-full justify-center">
              {busyPreview ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
              {busyPreview ? t("wb.running") : `${t("wb.runpreview")} (${selectedIds.length} tools)`}
            </button>
          </div>
        </Panel>
      </div>

      {/* preview */}
      <div className="xl:col-span-6 space-y-4">
        <Panel className="min-h-[300px]" glow>
          <PanelTitle
            right={
              preview && (
                <div className="flex items-center gap-2">
                  <select value={filterTool} onChange={(e) => setFilterTool(e.target.value)} className="!py-1 !px-2 text-[11px]">
                    <option value="all">
                      {t("wb.col.rule")} — all ({preview.diffs.length})
                    </option>
                    {[...new Set(preview.diffs.map((d) => d.ruleId))].map((r) => (
                      <option key={r} value={r}>
                        {r} ({preview.diffs.filter((d) => d.ruleId === r).length})
                      </option>
                    ))}
                  </select>
                  <input type="text" value={diffFilter} onChange={(e) => setDiffFilter(e.target.value)} placeholder="filter…" className="!py-1 !px-2 text-[11px] w-28" />
                </div>
              )
            }
          >
            {t("wb.preview.title")}
            {preview && <span className="ml-2 text-accent normal-case tracking-normal">{fmtNum(filteredDiffs.length)} diffs</span>}
          </PanelTitle>
          {err && <div className="mx-4 mb-3 text-hot text-xs mono border border-hot/40 bg-hot/10 rounded-lg px-3 py-2">{err}</div>}
          {!preview && !busyPreview && (
            <div className="px-6 py-16 text-center text-dim text-sm">
              <Layers size={26} className="mx-auto mb-3 opacity-40" />
              {t("wb.preview.hint")}
            </div>
          )}
          {busyPreview && (
            <div className="px-6 py-16 text-center text-dim text-sm">
              <Loader2 size={26} className="mx-auto mb-3 animate-spin text-accent" />
              {t("wb.running")}
            </div>
          )}
          {preview && !busyPreview && (
            <>
              {filteredDiffs.length === 0 && <div className="px-6 py-16 text-center text-dim text-sm">{t("wb.preview.empty")}</div>}
              {filteredDiffs.length > 0 && (
                <div className="max-h-[520px] overflow-auto">
                  <table className="table-x">
                    <thead>
                      <tr>
                        <th className="w-24">{t("wb.col.sheet")}</th>
                        <th className="w-16">{t("wb.col.cell")}</th>
                        <th>{t("wb.col.before")}</th>
                        <th className="w-6"></th>
                        <th>{t("wb.col.after")}</th>
                        <th className="w-16">{t("wb.col.rule")}</th>
                        <th className="w-14">{t("wb.col.conf")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDiffs.slice(0, 600).map((d, i) => (
                        <tr key={i} title={d.reason}>
                          <td className="mono text-[10px] text-dim">{d.sheet}</td>
                          <td className="mono text-[11px] text-accent">{d.cell}</td>
                          <td className="mono text-[10.5px] max-w-[220px]">
                            <span className="block truncate text-hot/90" title={String(d.before ?? "∅")}>
                              {d.before === null ? "∅" : String(d.before)}
                            </span>
                          </td>
                          <td className="text-dim">
                            <ChevronRight size={12} />
                          </td>
                          <td className="mono text-[10.5px] max-w-[220px]">
                            <span className="block truncate text-ok" title={String(d.after ?? "∅")}>
                              {d.after === null ? "∅" : String(d.after)}
                            </span>
                          </td>
                          <td>
                            <span className="mono text-[9px] px-1.5 py-0.5 rounded border border-edge2 text-dim">{d.ruleId}</span>
                          </td>
                          <td>
                            <div className="h-1 w-10 rounded-full bg-edge/60 overflow-hidden" title={`${Math.round(d.confidence * 100)}%`}>
                              <div className="h-full bg-accent" style={{ width: `${d.confidence * 100}%` }} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Panel>
      </div>

      {/* summary + apply */}
      <div className="xl:col-span-3 space-y-4">
        <Panel>
          <PanelTitle>{t("wb.preview.title")} — Δ</PanelTitle>
          <div className="px-4 pb-4 grid grid-cols-2 gap-2">
            {[
              { label: t("wb.sum.cells"), value: preview?.summary.cellsChanged, color: "#22d3ee" },
              { label: t("wb.sum.formulas"), value: preview?.summary.formulasChanged, color: "#38bdf8" },
              { label: t("wb.sum.rows"), value: preview?.summary.rowsRemoved, color: "#fbbf24" },
              { label: t("wb.sum.names"), value: preview?.summary.namesFixed, color: "#a78bfa" },
            ].map((x) => (
              <div key={x.label} className="rounded-lg border border-edge/60 bg-ink/50 p-2.5">
                <div className="mono text-lg font-bold" style={{ color: x.value ? x.color : "#4b5a75" }}>
                  {x.value ?? "—"}
                </div>
                <div className="text-[9.5px] text-dim">{x.label}</div>
              </div>
            ))}
            <div className="col-span-2 rounded-lg border border-edge/60 bg-ink/50 p-2.5">
              <div className="text-[9.5px] text-dim mb-1">{t("wb.sum.risks")}</div>
              {preview ? (
                <div className="flex items-center gap-2 mono text-lg">
                  <span className="text-hot font-bold">{preview.summary.riskScoreBefore}</span>
                  <span className="text-dim">→</span>
                  <span className={preview.summary.riskScoreAfter <= preview.summary.riskScoreBefore ? "text-ok font-bold" : "text-warn font-bold"}>
                    {preview.summary.riskScoreAfter}
                  </span>
                  <Sparkles size={13} className="text-ok ml-1" />
                </div>
              ) : (
                <div className="mono text-lg text-dim">—</div>
              )}
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelTitle>{t("ex.formats")}</PanelTitle>
          <div className="px-4 pb-3 space-y-1.5">
            {FORMATS.map((f) => (
              <label key={f.id} className="flex items-center justify-between gap-2 text-xs cursor-pointer py-1">
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formats.has(f.id)}
                    disabled={xlsxDisabled && f.id === "xlsx"}
                    onChange={() =>
                      setFormats((prev) => {
                        const next = new Set(prev);
                        if (next.has(f.id)) next.delete(f.id);
                        else next.add(f.id);
                        return next;
                      })
                    }
                    className="accent-cyan-400"
                  />
                  <span className="mono font-semibold text-accent">{f.label}</span>
                </span>
                <span className="text-dim text-[10px] text-right">{f.desc}</span>
              </label>
            ))}
            {xlsxDisabled && (
              <p className="text-[10px] text-warn mt-2">
                {hasMacroInput
                  ? lang === "jp"
                    ? "マクロを失わないよう、XLSMからのXLSX出力は無効です。CSV、JSON、NDJSON、Markdownを選択してください。"
                    : "XLSX export is disabled for macro-enabled input to prevent silent VBA loss. Choose CSV, JSON, NDJSON, or Markdown."
                  : lang === "jp"
                    ? "書式情報を完全に読み取れないため、書式の消失を防ぐ目的でXLSX出力を無効にしました。"
                    : "XLSX export is disabled because workbook style metadata could not be read reliably."}
              </p>
            )}
          </div>
          <div className="px-4 pb-4">
            <button onClick={apply} disabled={!preview || !formats.size || !!applyJob} className="btn btn-primary w-full justify-center !py-3">
              {applyJob ? <Loader2 size={15} className="animate-spin" /> : <PackageCheck size={15} />}
              {applyJob ? t("ex.working") : t("ex.run")}
            </button>
            {preview && preview.diffs.length === 0 && <div className="text-[10px] text-dim mt-2 text-center">{t("wb.preview.empty")}</div>}
            <p className="text-[10px] text-dim mt-2 leading-relaxed">{t("wb.apply.confirm")}</p>
            {isLocal && (
              <p className="text-[10px] text-ok/80 mt-1.5 flex items-center gap-1.5">
                <ShieldCheck size={11} />
                {t("ex.local")}
              </p>
            )}
          </div>
        </Panel>

        {applyDone && (
          <Panel glow className="p-4 space-y-2">
            <div className="text-[10px] uppercase tracking-[0.15em] text-ok font-semibold flex items-center gap-1.5">
              <PackageCheck size={12} />
              {t("ex.outputs")}
            </div>
            {applyDone.outputs.map((o) => (
              <div key={o.fileId + o.format} className="flex items-center justify-between gap-2 rounded-lg border border-edge/60 bg-ink/60 px-2.5 py-2">
                <div className="min-w-0">
                  <div className="text-[11px] mono truncate">{o.name}</div>
                  <div className="text-[9.5px] text-dim mono">
                    {o.format} · {fmtBytes(o.size)}
                  </div>
                </div>
                {o.fileId !== "local" ? (
                  <button
                    onClick={() => handleDownload(o.fileId, o.name)}
                    disabled={downloading === o.fileId}
                    className="btn btn-ghost !py-1 !px-2 text-[10px] shrink-0"
                    aria-label={`Download ${o.name}`}
                  >
                    {downloading === o.fileId ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                  </button>
                ) : (
                  <span className="chip text-ok border-ok/30 bg-ok/10 shrink-0">saved</span>
                )}
              </div>
            ))}
            <button onClick={() => router.push(`/analysis/${detail.id}?tab=export`)} className="text-[10px] text-accent hover:underline">
              {t("an.tabs.export")} →
            </button>
          </Panel>
        )}
        {applyJob && (
          <Panel className="p-4">
            <div className="text-xs text-dim mb-2">{t("ex.working")}</div>
            <div className="h-1.5 rounded-full bg-edge/70 overflow-hidden">
              <div className="h-full w-1/2 rounded-full bg-accent animate-pulse" />
            </div>
          </Panel>
        )}

        {preview && !isLocal && (
          <div className="text-[10px] text-dim flex items-center gap-1.5 px-1 mono">
            preview {preview.previewId.slice(0, 8)} · tools: {preview.tools.join(" ")} · deterministic
          </div>
        )}
      </div>
    </div>
  );
}
