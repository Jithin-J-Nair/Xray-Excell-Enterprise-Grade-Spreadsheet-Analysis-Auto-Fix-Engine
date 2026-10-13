"use client";
import { useCallback, useEffect, useState } from "react";
import { BookLock, ShieldCheck, Plus, Braces, CheckCircle2, Wand2 } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { Panel, PanelTitle } from "@/components/ui";

interface RuleRow {
  id: string;
  group: string;
  name: string;
  description: string;
  safeDefault: boolean;
  autoFix: boolean;
  targets: string[];
}

interface CustomRule {
  id: string;
  name: string;
  group: string;
  description: string;
  definition: unknown;
  createdAt: string;
}

export default function SettingsPage() {
  const { t, lang } = useI18n();
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [customs, setCustoms] = useState<CustomRule[]>([]);
  const [autofix, setAutofix] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [def, setDef] = useState('{\n  "in": "string",\n  "match": "regex",\n  "action": "flag|transform",\n  "params": {}\n}');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/rules");
    const j = await r.json();
    setRules(j.rules ?? []);
    setCustoms(j.customRules ?? []);
    setAutofix(j.autoFix ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(def);
      } catch {
        throw new Error("Definition must be valid JSON");
      }
      const r = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: desc, definition: parsed }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message ?? "failed");
      setMsg(`Rule registered: ${j.id}`);
      setName("");
      setDesc("");
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const groupColor: Record<string, string> = { organize: "#38bdf8", clean: "#34d399", mitigate: "#f472b6", custom: "#a78bfa" };

  return (
    <div className="max-w-[1100px] mx-auto px-5 pt-12 pb-20">
      <div className="flex items-center gap-3 mb-2">
        <BookLock size={20} className="text-accent" />
        <h1 className="text-2xl font-black tracking-tight">{t("settings.title")}</h1>
      </div>
      <p className="text-dim text-sm mb-8 max-w-2xl">{t("settings.sub")}</p>

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
                <th className="w-24">Auto-Fix</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td className="mono text-[11px] text-accent">{r.id}</td>
                  <td>
                    <span className="chip" style={{ color: groupColor[r.group] ?? "#7d90ad", borderColor: `${groupColor[r.group] ?? "#7d90ad"}55`, background: `${groupColor[r.group] ?? "#7d90ad"}11` }}>
                      {r.group}
                    </span>
                  </td>
                  <td className="text-xs font-medium">{r.name}</td>
                  <td className="text-[11.5px] text-dim leading-relaxed">{r.description}</td>
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
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid md:grid-cols-2 gap-4">
        <Panel>
          <PanelTitle>{t("settings.custom")}</PanelTitle>
          <div className="px-4 pb-4 space-y-2">
            {customs.map((c) => (
              <div key={c.id} className="rounded-lg border border-edge/60 bg-ink/50 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Braces size={12} className="text-accent2" />
                  <span className="text-sm font-medium">{c.name}</span>
                  <span className="mono text-[9px] text-dim ml-auto">{new Date(c.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="text-[11px] text-dim mb-2">{c.description}</div>
                <pre className="mono text-[9.5px] text-accent/70 bg-void/70 rounded p-2 overflow-x-auto">{JSON.stringify(c.definition, null, 1).slice(0, 300)}</pre>
              </div>
            ))}
            {!customs.length && <div className="text-center text-dim text-xs py-6">{t("common.empty")}</div>}
          </div>
        </Panel>

        <Panel>
          <PanelTitle>
            <span className="flex items-center gap-1.5">
              <Plus size={12} />
              {t("settings.custom.add")}
            </span>
          </PanelTitle>
          <div className="px-4 pb-4 space-y-3">
            <div>
              <label className="text-[10px] text-dim uppercase tracking-widest">{t("settings.custom.name")}</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full mt-1" placeholder="PII: detect 携帯電話 patterns" />
            </div>
            <div>
              <label className="text-[10px] text-dim uppercase tracking-widest">{t("settings.custom.desc")}</label>
              <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} className="w-full mt-1" placeholder="What this rule detects or rewrites…" />
            </div>
            <div>
              <label className="text-[10px] text-dim uppercase tracking-widest">{t("settings.custom.def")}</label>
              <textarea value={def} onChange={(e) => setDef(e.target.value)} rows={8} className="w-full mt-1 mono text-[11px]" />
            </div>
            <button onClick={submit} disabled={busy || !name.trim()} className="btn btn-primary w-full justify-center">
              {t("settings.custom.submit")}
            </button>
            {msg && <div className="text-[11px] mono text-ok border border-ok/30 bg-ok/10 rounded-lg px-3 py-2">{msg}</div>}
          </div>
        </Panel>
      </div>

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
