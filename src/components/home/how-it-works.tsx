"use client";

import { useEffect, useState } from "react";
import { SheetScan } from "@/components/home/sheet-scan";

const STEPS = [
  {
    n: "01",
    title: "Upload the workbook",
    body: "Drop an .xlsx, .xlsm, or a folder of linked files. The original stays read-only.",
  },
  {
    n: "02",
    title: "See every issue",
    body: "Broken refs, circular formulas, messy text, and cross-file links are listed and ranked.",
  },
  {
    n: "03",
    title: "Preview, keep, download",
    body: "Tick the cell changes you want. Download a fixed copy — the source file is never overwritten.",
  },
];

export function HowItWorks() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const id = window.setInterval(() => setActive((i) => (i + 1) % STEPS.length), 3200);
    return () => window.clearInterval(id);
  }, []);

  return (
    <section className="section ground-surface" id="how" aria-labelledby="how-h">
      <div className="wrap how-layout">
        <div>
          <div className="section-head">
            <h2 id="how-h">How a workbook scan runs</h2>
            <p className="measure" style={{ color: "var(--p-muted)", marginTop: 16, fontSize: 16, lineHeight: 1.55 }}>
              Three steps. Nothing is written back to your original until you choose to download a copy.
            </p>
          </div>
          <div className="how-track how-track--stack">
            {STEPS.map((s, i) => (
              <button
                key={s.n}
                type="button"
                className={`how-step ${i === active ? "is-active" : ""}`}
                onClick={() => setActive(i)}
                aria-pressed={i === active}
              >
                <div className="how-step__n">{s.n}</div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                <span className="how-step__bar" aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
        <div className="how-scan-stage">
          <SheetScan />
        </div>
      </div>
    </section>
  );
}
