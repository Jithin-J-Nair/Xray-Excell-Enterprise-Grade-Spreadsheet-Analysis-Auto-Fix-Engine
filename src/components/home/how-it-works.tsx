"use client";

import { useEffect, useState } from "react";

const STEPS = [
  {
    n: "01",
    title: "Upload the workbook",
    body: "Drop .xlsx, .xlsm or a folder of linked files. The original stays read-only.",
    node: "UPLOAD",
  },
  {
    n: "02",
    title: "Build the formula graph",
    body: "Every formula, named range and cross-file link becomes a dependency edge.",
    node: "GRAPH",
  },
  {
    n: "03",
    title: "Apply reversible patches",
    body: "Risk rules propose fixes. Each accept writes a forward patch and its reverse.",
    node: "PATCH",
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
    <section className="section ground-surface" id="how" style={{ ["--h" as string]: 1 }} aria-labelledby="how-h">
      <div className="wrap">
        <div className="section-head">
          <h2 id="how-h">How a workbook scan runs</h2>
          <p className="measure" style={{ color: "var(--p-muted)", marginTop: 16, fontSize: 16, lineHeight: 1.55 }}>
            Three stages, one pass. No rewrite of the source file until you accept a patch.
          </p>
        </div>

        <div className="how-track" role="list">
          {STEPS.map((s, i) => (
            <button
              key={s.n}
              type="button"
              className={`how-step ${i === active ? "is-active" : ""}`}
              role="listitem"
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

        <div className="how-viz" aria-hidden="true">
          <div className="how-viz__nodes">
            {STEPS.map((s, i) => (
              <div key={s.n} style={{ display: "contents" }}>
                <div className={`how-node ${i <= active ? "is-on" : ""}`}>
                  <div className="how-node__box">{s.node}</div>
                  <div style={{ fontSize: 13, color: "var(--p-muted)" }}>{s.title}</div>
                </div>
                {i < STEPS.length - 1 && <div className={`how-edge ${i < active ? "is-on" : ""}`} />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
