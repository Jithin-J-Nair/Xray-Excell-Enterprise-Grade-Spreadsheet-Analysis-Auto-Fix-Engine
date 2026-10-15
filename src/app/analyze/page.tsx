"use client";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { CloudUpload, FileSpreadsheet, X, ScanSearch, Beaker, ShieldCheck, Server, FileWarning } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { Panel, PanelTitle, Switch, fmtBytes } from "@/components/ui";

interface Picked {
  file: File;
  id: string;
}

export default function AnalyzePage() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [files, setFiles] = useState<Picked[]>([]);
  const [drag, setDrag] = useState(false);
  const [crossFile, setCrossFile] = useState(true);
  const [mode, setMode] = useState<"server" | "local">("server");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((list: FileList | null) => {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list);
    if (files.length + incoming.length > 12) {
      setErr("A batch can contain at most 12 files. Choose a smaller folder or remove files before adding more.");
      return;
    }
    const next: Picked[] = incoming.map((file) => ({
      file,
      relativePath: file.webkitRelativePath || undefined,
      id: `${file.webkitRelativePath || file.name}-${file.size}-${crypto.randomUUID().slice(0, 8)}`,
    }));
    setErr(null);
    setFiles((prev) => [...prev, ...next]);
  }, [files.length]);

  const genSample = async (kind: string) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/samples", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "failed");
      await startAnalysis(json.uploadId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const startAnalysis = async (uploadId: string) => {
    const res = await fetch("/api/analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId, options: { resolveCrossFile: crossFile, language: lang } }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message ?? "failed to start analysis");
    router.push(`/analysis/${json.analysisId}`);
  };

  const submit = async () => {
    if (!files.length) return;
    setBusy(true);
    setErr(null);
    try {
      if (mode === "local") {
        // Parse + analyze fully in-browser with the isomorphic engine.
        const { parseFile } = await import("@/lib/excel/parse");
        const { analyzeAll } = await import("@/lib/excel/analyze");
        const models = [];
        const metas = [];
        for (const p of files) {
          const bytes = new Uint8Array(await p.file.arrayBuffer());
          const model = await parseFile(p.id, p.file.name, bytes);
          models.push(model);
          metas.push({ id: p.id, name: p.file.name, size: p.file.size, encoding: model.encoding });
        }
        const result = analyzeAll(models, metas, { language: lang, resolveCrossFile: crossFile, name: files[0].file.name });
        const res = await fetch("/api/analysis/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: files[0].file.name, language: lang, result }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.message ?? "import failed");
        router.push(`/analysis/${json.analysisId}`);
        return;
      }
      const form = new FormData();
      for (const p of files) form.append("files", p.file, p.file.name);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "upload failed");
      await startAnalysis(json.uploadId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <div className="grid-bg absolute inset-x-0 top-0 h-[320px] pointer-events-none" />
      <div className="max-w-3xl mx-auto px-5 pt-12 pb-20 relative">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <h1 className="text-3xl font-black tracking-tight mb-2">{t("nav.new")}</h1>
          <p className="text-dim text-sm mb-8">{t("app.tagline")}</p>

          {/* dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              addFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            className={`reticle cursor-pointer rounded-2xl border-2 border-dashed p-12 text-center transition-all ${
              drag ? "border-accent bg-accent/10 scale-[1.01]" : "border-edge2 hover:border-accent/50 hover:bg-accent/5"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              accept=".xlsx,.xlsm,.xlsb,.xls,.csv,.tsv,.json,.ndjson,.txt"
              onChange={(e) => addFiles(e.target.files)}
            />
            <CloudUpload size={38} className={`mx-auto mb-4 ${drag ? "text-accent" : "text-dim"}`} />
            <div className="font-semibold mb-1.5">{t("up.drop.title")}</div>
            <div className="text-xs text-dim max-w-md mx-auto">{t("up.drop.sub")}</div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              ref={folderInputRef}
              type="file"
              multiple
              className="hidden"
              accept=".xlsx,.xlsm,.xlsb,.xls,.csv,.tsv,.json,.ndjson,.txt"
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              onChange={(e) => { addFiles(e.target.files); e.currentTarget.value = ""; }}
            />
            <button type="button" className="btn btn-ghost text-xs" onClick={() => folderInputRef.current?.click()}>
              <FileSpreadsheet size={14} /> {t("up.folder")}
            </button>
            <span className="text-[11px] text-dim">Folder selection keeps nested paths visible in the file list; batches are limited to 12 files.</span>
          </div>

          {/* file list */}
          {files.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="text-xs text-dim mono">{t("up.files.selected", { n: files.length })}</div>
              {files.map((p) => (
                <div key={p.id} className="panel px-3 py-2.5 flex items-center gap-3">
                  <FileSpreadsheet size={16} className="text-accent shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{p.relativePath ?? p.file.name}</div>
                    <div className="text-[11px] text-dim mono">{fmtBytes(p.file.size)}</div>
                  </div>
                  <button
                    onClick={() => setFiles((prev) => prev.filter((x) => x.id !== p.id))}
                    className="text-dim hover:text-hot transition-colors"
                    aria-label="Remove file"
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* options */}
          <Panel className="mt-6 p-5">
            <PanelTitle>{t("up.options")}</PanelTitle>
            <div className="px-1 pb-1 space-y-4">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="text-txt/90">{t("up.crossfile")}</span>
                <Switch checked={crossFile} onChange={setCrossFile} />
              </label>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-txt/90">{t("up.mode")}</span>
                <div className="flex gap-2">
                  <button onClick={() => setMode("server")} className={`btn text-xs ${mode === "server" ? "btn-primary" : "btn-ghost"}`}>
                    <Server size={13} />
                    {t("up.mode.server")}
                  </button>
                  <button onClick={() => setMode("local")} className={`btn text-xs ${mode === "local" ? "btn-primary" : "btn-ghost"}`}>
                    <ShieldCheck size={13} />
                    {t("up.mode.local")}
                  </button>
                </div>
              </div>
              {mode === "local" && (
                <div className="text-[11px] text-ok/90 flex items-center gap-2 border border-ok/25 bg-ok/5 rounded-lg px-3 py-2">
                  <ShieldCheck size={13} />
                  {t("dash.local.desc")}
                </div>
              )}
            </div>
          </Panel>

          {err && (
            <div className="mt-4 flex items-start gap-2.5 border border-hot/40 bg-hot/10 rounded-xl px-4 py-3 text-sm text-hot">
              <FileWarning size={16} className="mt-0.5 shrink-0" />
              <span className="mono text-xs leading-relaxed">{err}</span>
            </div>
          )}

          <div className="mt-6 flex items-center gap-3">
            <button onClick={submit} disabled={!files.length || busy} className="btn btn-primary flex-1 justify-center !py-3">
              <ScanSearch size={16} />
              {busy ? t("up.scanning") : t("up.start")}
            </button>
          </div>

          <div className="mt-8">
            <div className="text-[11px] uppercase tracking-[0.15em] text-dim mb-3">{t("up.samples")}</div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => genSample("monster")} disabled={busy} className="btn btn-ghost text-xs">
                <Beaker size={13} />
                Monster (22 sheets · circulars · externals)
              </button>
              <button onClick={() => genSample("jp")} disabled={busy} className="btn btn-ghost text-xs">
                <Beaker size={13} />
                日本語メシーブック
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
