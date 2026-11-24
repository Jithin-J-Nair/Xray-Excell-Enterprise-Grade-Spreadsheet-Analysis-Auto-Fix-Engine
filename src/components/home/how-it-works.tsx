"use client";

import { useEffect, useState } from "react";
import { SheetScan } from "@/components/home/sheet-scan";

const STEPS = [
  {
    n: "01",
    title: "Upload the workbook",
    body: "Drop .xlsx, .xlsm or a folder of linked files. The original stays read-only.",
  },
  {
    n: "02",
    title: "Scan every formula",
    body: "A beam walks the grid. Broken refs, circles and cross-file links get flagged.",
  },
  {
    n: "03",
    title: "Patch and reverse",
    body: "Accept a fix and the engine writes a forward patch plus its reverse undo.",
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
              Three stages, one pass. No rewrite of the source file until you accept a patch.
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
