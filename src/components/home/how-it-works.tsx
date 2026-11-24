"use client";

import { useEffect, useMemo, useState } from "react";
import { SheetScan } from "@/components/home/sheet-scan";
import { useI18n } from "@/components/i18n";

export function HowItWorks() {
  const { t } = useI18n();
  const [active, setActive] = useState(0);
  const steps = useMemo(
    () => [
      { n: "01", title: t("home.how.1.title"), body: t("home.how.1.body") },
      { n: "02", title: t("home.how.2.title"), body: t("home.how.2.body") },
      { n: "03", title: t("home.how.3.title"), body: t("home.how.3.body") },
    ],
    [t]
  );

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const id = window.setInterval(() => setActive((i) => (i + 1) % steps.length), 3200);
    return () => window.clearInterval(id);
  }, [steps.length]);

  return (
    <section className="section ground-surface" id="how" aria-labelledby="how-h">
      <div className="wrap how-layout">
        <div>
          <div className="section-head">
            <h2 id="how-h">{t("home.how.h2")}</h2>
            <p className="measure" style={{ color: "var(--p-muted)", marginTop: 16, fontSize: 16, lineHeight: 1.55 }}>
              {t("home.how.lead")}
            </p>
          </div>
          <div className="how-track how-track--stack">
            {steps.map((s, i) => (
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
