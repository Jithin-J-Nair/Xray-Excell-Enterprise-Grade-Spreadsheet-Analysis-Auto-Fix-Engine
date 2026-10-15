"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Download, FileCheck2, Loader2, ShieldCheck, Sparkles, Undo2, WandSparkles } from "lucide-react";
import type { AnalysisDetail } from "@/components/analysis/shared";

type Action = "profile" | "preview" | "verify" | "apply" | "undo";
type Feature = "formatting" | "numberFormats" | "formulaRepairs";
interface Output { fileId: string; name: string; size: number; downloadUrl?: string }
interface Finding { code?: string; cell?: string; kind?: string; confidence?: number; message?: string; reason?: string; before?: string; proposed?: string; applied?: boolean }
interface ProfileFile {
  fileName: string;
  quality: { columns: { header: string; inferredType: string; nonEmpty: number }[]; totalFindings: number; findings: Finding[]; truncated: boolean };
  numberFormats: { totalFindings: number; findings: Finding[]; truncated: boolean };
  formulaRepairs: { totalProposals: number; proposals: Finding[]; truncated: boolean };
}
interface PreviewFile { fileName: string; changes: Record<Feature, number>; profile?: { totalProposals: number; proposals: Finding[]; truncated: boolean } }
interface VerifyFile { fileName: string; report: { ok: boolean; issues: { code: string; message: string; cell?: string }[] } }
interface ApiResult {
  action?: string; message?: string; errorCode?: string; jobId?: string; files?: ProfileFile[] | PreviewFile[] | VerifyFile[];
  outputs?: Output[]; status?: string; features?: Feature[]; skippedFiles?: { fileName: string; reason: string }[];
}

const FEATURE_LABELS: Record<Feature, string> = {
  formatting: "Professional formatting",
  numberFormats: "Number-format repair",
  formulaRepairs: "Formula repair proposals",
};

export function EnhancementTab({ detail, reload }: { detail: AnalysisDetail; reload: () => Promise<unknown> }) {
  const [features, setFeatures] = useState<Feature[]>(["formatting", "numberFormats"]);
  const [theme, setTheme] = useState<"report" | "financial">("report");
  const [currencyCode, setCurrencyCode] = useState<"JPY" | "USD" | "EUR" | "GBP" | "CAD" | "AUD">("JPY");
  const [refitWidths, setRefitWidths] = useState(true);
  const [confirmFormulaRepairs, setConfirmFormulaRepairs] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [profile, setProfile] = useState<ProfileFile[] | null>(null);
  const [preview, setPreview] = useState<PreviewFile[] | null>(null);
  const [verification, setVerification] = useState<VerifyFile[] | null>(null);
  const [recentOutputs, setRecentOutputs] = useState<Output[]>([]);
  const [recentJobId, setRecentJobId] = useState<string | null>(null);

  const serverReady = detail.mode === "server" && detail.status === "completed" && !!detail.result;
  const enhancementRunning = detail.jobs.some(job => job.kind === "enhancement" && job.status === "running");
  const undoableJob = useMemo(() => [...detail.jobs]
    .filter(job => job.kind === "enhancement" && job.status === "completed" && !job.reverted && !!job.patchFileId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0], [detail.jobs]);
  const displayedOutputs = recentOutputs.length ? recentOutputs : (undoableJob?.outputs ?? []).map(output => ({
    fileId: output.fileId, name: output.name, size: output.size, downloadUrl: "/api/outputs/" + output.fileId + "/download",
  }));

  function toggleFeature(feature: Feature, checked: boolean) {
    setFeatures(current => checked ? [...new Set([...current, feature])] : current.filter(item => item !== feature));
    setError(""); setNotice("");
  }

  async function request(action: Action, extra: Record<string, unknown> = {}) {
    setBusy(action); setError(""); setNotice("");
    try {
      const response = await fetch("/api/analysis/" + detail.id + "/enhancement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          features,
          options: { theme, currencyCode, minConfidence: 0.9, preserveExistingStyles: true, preserveExistingColumnWidths: !refitWidths },
          ...extra,
        }),
      });
      const data = await response.json() as ApiResult;
      if (!response.ok) throw new Error(data.message ?? data.errorCode ?? "Enhancement request failed.");
      if (action === "profile") setProfile((data.files ?? []) as ProfileFile[]);
      if (action === "preview") setPreview((data.files ?? []) as PreviewFile[]);
      if (action === "verify") setVerification((data.files ?? []) as VerifyFile[]);
      if (action === "apply") {
        setRecentOutputs(data.outputs ?? []);
        setRecentJobId(data.jobId ?? null);
        setNotice(data.skippedFiles?.length ? "Verified " + (data.outputs?.length ?? 0) + " output(s); skipped " + data.skippedFiles.length + " unsupported workbook(s). See job summary for details." : "Enhanced workbook copies created and offline verification passed.");
      } else if (action === "undo") {
        setRecentOutputs(data.outputs ?? []);
        setRecentJobId(null);
        setNotice("The saved pre-enhancement workbook model was restored to new output copies.");
      } else {
        setNotice(action === "profile" ? "Read-only workbook profile completed." : action === "preview" ? "Preview complete. No workbook files were changed." : "Offline verification completed.");
      }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function runUndo() {
    if (!undoableJob) return;
    if (!window.confirm("Undo this enhancement? The engine will refuse if the workbook has changed since that enhancement.")) return;
    void request("undo", { jobId: undoableJob.id });
  }

  return (
    <div className="space-y-5">
      <section className="panel p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-accent/30 bg-accent/10 p-3 text-accent"><Sparkles size={20} /></div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold">Enhancement Engine</h2>
            <p className="text-sm text-dim mt-1">Profile data quality, preview conservative repairs, improve formatting, verify the exported workbook, and undo from a persisted recovery snapshot.</p>
            <div className="flex items-center gap-2 mt-3 text-xs text-dim">
              <ShieldCheck size={14} />
              <span>Source files are never overwritten. Unsupported OOXML features are blocked rather than silently discarded.</span>
            </div>
          </div>
        </div>
        {enhancementRunning && <div className="mt-4 rounded-lg border border-warn/30 bg-warn/5 p-3 text-sm text-dim">An enhancement or undo operation is already running for this analysis. Wait for it to finish before starting another operation.</div>}
        {!serverReady && (
          <div className="mt-4 rounded-lg border border-warn/30 bg-warn/5 p-3 text-sm text-dim">
            {detail.mode === "local" ? "The enhancement API currently runs on server-mode analyses. Local/private browser-mode enhancements are not wired to this panel." : "Wait for the server analysis to complete before using enhancement tools."}
          </div>
        )}
      </section>

      <section className="panel p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">Enhancement settings</h3>
          <span className="chip mono text-[10px]">{features.length} selected</span>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {(["formatting", "numberFormats", "formulaRepairs"] as Feature[]).map(feature => (
            <label key={feature} className="flex items-start gap-2.5 rounded-lg border border-edge/70 p-3 cursor-pointer hover:border-accent/50">
              <input type="checkbox" className="mt-1 accent-current" checked={features.includes(feature)} onChange={event => toggleFeature(feature, event.target.checked)} />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{FEATURE_LABELS[feature]}</span>
                <span className="block text-xs text-dim mt-0.5">{feature === "formatting" ? "Theme, header styling, alignment, banding and content-based widths." : feature === "numberFormats" ? "Confidence-gated dates, currency, percentage and numeric display formats." : "Structural suggestions only; formulas are not changed without explicit confirmation."}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-xs text-dim space-y-1">
            <span className="block">Visual theme</span>
            <select value={theme} onChange={event => setTheme(event.target.value as "report" | "financial")} className="field w-full">
              <option value="report">Professional report</option>
              <option value="financial">Financial statement</option>
            </select>
          </label>
          <label className="text-xs text-dim space-y-1">
            <span className="block">Currency convention</span>
            <select value={currencyCode} onChange={event => setCurrencyCode(event.target.value as typeof currencyCode)} className="field w-full">
              <option value="JPY">JPY — Japanese yen</option><option value="USD">USD — US dollar</option><option value="EUR">EUR — euro</option><option value="GBP">GBP — pound sterling</option><option value="CAD">CAD — Canadian dollar</option><option value="AUD">AUD — Australian dollar</option>
            </select>
          </label>
        </div>
        {features.includes("formatting") && (
          <label className="flex items-start gap-2 text-sm text-dim">
            <input type="checkbox" className="mt-1 accent-current" checked={refitWidths} onChange={event => setRefitWidths(event.target.checked)} />
            Refit existing column widths when they are too narrow
          </label>
        )}
        {features.includes("formulaRepairs") && (
          <label className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/5 p-3 text-sm">
            <input type="checkbox" className="mt-1 accent-current" checked={confirmFormulaRepairs} onChange={event => setConfirmFormulaRepairs(event.target.checked)} />
            <span><strong>Explicit formula-change authorization.</strong><span className="block text-xs text-dim mt-1">I reviewed the proposals and understand that structural similarity does not prove business correctness.</span></span>
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-ghost text-sm" disabled={!serverReady || !!busy || enhancementRunning} onClick={() => void request("profile", { features: undefined })}>
            {busy === "profile" ? <Loader2 size={14} className="animate-spin" /> : <ClipboardCheck size={14} />} Profile workbook
          </button>
          <button className="btn btn-ghost text-sm" disabled={!serverReady || !!busy || features.length === 0} onClick={() => void request("preview")}>
            {busy === "preview" ? <Loader2 size={14} className="animate-spin" /> : <WandSparkles size={14} />} Preview
          </button>
          <button className="btn btn-primary text-sm" disabled={!serverReady || !!busy || features.length === 0 || (features.includes("formulaRepairs") && !confirmFormulaRepairs)} onClick={() => void request("apply", { confirmFormulaRepairs })}>
            {busy === "apply" ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Apply & verify
          </button>
          <button className="btn btn-ghost text-sm" disabled={!serverReady || !!busy} onClick={() => void request("verify", { features: undefined })}>
            {busy === "verify" ? <Loader2 size={14} className="animate-spin" /> : <FileCheck2 size={14} />} Verify current model
          </button>
          <button className="btn btn-ghost text-sm" disabled={!serverReady || !!busy || !undoableJob} onClick={runUndo}>
            {busy === "undo" ? <Loader2 size={14} className="animate-spin" /> : <Undo2 size={14} />} Undo latest enhancement
          </button>
        </div>
        {error && <div role="alert" className="rounded-lg border border-hot/30 bg-hot/5 p-3 text-sm text-hot"><AlertTriangle size={14} className="inline mr-2" />{error}</div>}
        {notice && <div role="status" className="rounded-lg border border-ok/30 bg-ok/5 p-3 text-sm text-ok"><CheckCircle2 size={14} className="inline mr-2" />{notice}{recentJobId ? " Job: " + recentJobId.slice(0, 8) : ""}</div>}
      </section>

      {profile && <section className="panel p-5 space-y-4">
        <h3 className="font-semibold">Read-only profile</h3>
        {profile.map(file => <div key={file.fileName} className="space-y-2">
          <h4 className="text-sm font-medium truncate">{file.fileName}</h4>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-edge/30 p-3"><div className="mono text-xl font-bold">{file.quality.totalFindings}</div><div className="text-[11px] text-dim">Quality findings</div></div>
            <div className="rounded-lg bg-edge/30 p-3"><div className="mono text-xl font-bold">{file.numberFormats.totalFindings}</div><div className="text-[11px] text-dim">Format proposals</div></div>
            <div className="rounded-lg bg-edge/30 p-3"><div className="mono text-xl font-bold">{file.formulaRepairs.totalProposals}</div><div className="text-[11px] text-dim">Formula proposals</div></div>
          </div>
          {!!file.quality.findings.length && <ul className="space-y-1 text-xs text-dim">{file.quality.findings.slice(0, 12).map((finding, index) => <li key={finding.code + (finding.cell ?? "") + index} className="border-l-2 border-edge pl-2"><strong>{finding.code}</strong>{finding.cell ? " · " + finding.cell : ""}{finding.message ? " — " + finding.message : ""}</li>)}</ul>}
          {file.quality.truncated && <p className="text-xs text-dim">Showing the first 500 quality findings.</p>}
        </div>)}
      </section>}

      {preview && <section className="panel p-5 space-y-3">
        <h3 className="font-semibold">Preview results</h3>
        {preview.map(file => <div key={file.fileName} className="border border-edge/70 rounded-lg p-3">
          <div className="font-medium text-sm truncate mb-2">{file.fileName}</div>
          <div className="grid grid-cols-3 gap-2 text-xs">{(["formatting", "numberFormats", "formulaRepairs"] as Feature[]).map(feature => <div key={feature} className="bg-edge/30 rounded p-2"><div className="mono text-lg">{file.changes?.[feature] ?? 0}</div><div className="text-dim">{FEATURE_LABELS[feature]}</div></div>)}</div>
          {file.profile?.proposals?.slice(0, 8).map((proposal, index) => <p key={(proposal.cell ?? "") + index} className="text-xs text-dim mt-2">{proposal.cell}: {proposal.before} → {proposal.proposed} ({Math.round((proposal.confidence ?? 0) * 100)}%)</p>)}
        </div>)}
      </section>}

      {verification && <section className="panel p-5 space-y-3">
        <h3 className="font-semibold">Offline verification</h3>
        {verification.map(file => <div key={file.fileName} className="border border-edge/70 rounded-lg p-3">
          <div className="flex items-center gap-2 text-sm font-medium">{file.report.ok ? <CheckCircle2 size={15} className="text-ok" /> : <AlertTriangle size={15} className="text-hot" />}{file.fileName}<span className="ml-auto text-xs">{file.report.ok ? "PASS" : "BLOCKED / FAILED"}</span></div>
          {file.report.issues.slice(0, 12).map((issue, index) => <p key={issue.code + index} className="text-xs text-dim mt-2">{issue.code}: {issue.message}</p>)}
        </div>)}
      </section>}

      {!!displayedOutputs.length && <section className="panel p-5 space-y-3">
        <h3 className="font-semibold">Generated workbook copies</h3>
        {displayedOutputs.map(output => <div key={output.fileId} className="flex items-center gap-3 border border-edge/70 rounded-lg p-3">
          <FileCheck2 size={16} className="text-ok shrink-0" />
          <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{output.name}</div><div className="mono text-[10px] text-dim">{(output.size / 1024).toFixed(1)} KB · {output.fileId.slice(0, 8)}</div></div>
          <a href={output.downloadUrl ?? "/api/outputs/" + output.fileId + "/download"} className="btn btn-ghost text-xs"><Download size={13} /> Download</a>
        </div>)}
      </section>}
    </div>
  );
}
