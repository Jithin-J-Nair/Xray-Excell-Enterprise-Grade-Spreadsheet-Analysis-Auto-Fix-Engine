"use client";

import Link from "next/link";
import { useI18n } from "@/components/i18n";

/** Huge-type close band: statement fills the wrap, primary under it. */
export function HugeCta() {
  const { t } = useI18n();
  return (
    <div className="closing__cta close--word huge-cta">
      <p className="huge-cta__kicker mono">{t("home.close.kicker")}</p>
      <h2 id="go-h" className="huge-cta__type" data-moment="liquid-type" data-moment-opts='{"strength":0.85}'>
        {t("home.close.h2")}
      </h2>
      <p className="huge-cta__lead">{t("home.close.lead")}</p>
      <Link className="btn btn--primary btn--xl btn--wide" href="/analyze">
        {t("home.cta.scan")}
        <svg className="m-arrow" width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M3 8h10M9 4l4 4-4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Link>
    </div>
  );
}
