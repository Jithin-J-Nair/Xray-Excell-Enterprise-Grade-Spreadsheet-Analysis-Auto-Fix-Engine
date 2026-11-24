"use client";

import Link from "next/link";

/** Huge-type close band: statement fills the wrap, primary under it. */
export function HugeCta() {
  return (
    <div className="closing__cta close--word huge-cta">
      <p className="huge-cta__kicker mono">NEXT STEP</p>
      <h2 id="go-h" className="huge-cta__type" data-moment="liquid-type" data-moment-opts='{"strength":0.85}'>
        Clean up the workbook.
      </h2>
      <p className="huge-cta__lead">
        Upload an Excel file. Get a health score, a clear issue list, and a preview of fixes — then download a copy. Your original stays safe.
      </p>
      <Link className="btn btn--primary btn--xl btn--wide" href="/analyze">
        Start a workbook scan
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
