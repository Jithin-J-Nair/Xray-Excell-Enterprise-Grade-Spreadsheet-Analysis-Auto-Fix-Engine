"use client";

import Link from "next/link";

/** Huge-type close band: statement fills the wrap, primary under it. */
export function HugeCta() {
  return (
    <div className="closing__cta close--word huge-cta">
      <p className="huge-cta__kicker mono">NEXT ACTION</p>
      <h2 id="go-h" className="huge-cta__type" data-moment="liquid-type" data-moment-opts='{"strength":0.85}'>
        Fix the workbook.
      </h2>
      <p className="huge-cta__lead">
        Upload an .xlsx. Get a health score, a risk list and a reversible patch queue — originals stay immutable.
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
