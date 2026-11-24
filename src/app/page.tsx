"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HowItWorks } from "@/components/home/how-it-works";
import { StatusChip, fmtNum, relTime } from "@/components/ui";
import { useI18n } from "@/components/i18n";

interface Recent {
  id: string;
  name: string;
  status: string;
  progress: number;
  mode: string;
  createdAt: string;
  riskScore: number | null;
  healthScore: number | null;
  riskCount: number | null;
  formulaCount: number | null;
}

interface Dash {
  stats: {
    totalAnalyses: number;
    completed: number;
    avgHealth: number | null;
    totalRisks: number;
    totalFormulas: number;
    applied: number;
    uploadsCount: number;
    exportsCount: number;
    bytesProcessed: number;
  };
  recent: Recent[];
  audits: { id: string; action: string; detail: unknown; at: string }[];
}

function healthColor(h: number | null): string {
  if (h === null) return "var(--p-muted)";
  if (h >= 75) return "var(--color-ok)";
  if (h >= 45) return "var(--color-warn)";
  return "#fb7185";
}

function HeroUi() {
  return (
    <div className="xray-hero-ui" data-visual="">
      <div
        data-fx="painterly-landscape"
        data-fx-seed="11"
        data-fx-palette='{"bg":"#18191b","surface":"#222427","ink":"#eff0f1","muted":"#9c9ea3","accent":"#ff4a1f"}'
        data-fx-params='{"blur":0.7,"brush":0.45,"slope":12,"hillY":0.18,"horizon":0.55,"calm":0.35,"calmX":0.55,"calmY":0.4,"drift":0.02,"side":1}'
        style={{ position: "absolute", inset: 0, opacity: 0.35, pointerEvents: "none" }}
        aria-hidden="true"
      />
      <div className="xray-hero-ui__bar" style={{ position: "relative" }}>
        <span className="xray-hero-ui__dot" />
        <span className="xray-hero-ui__dot" />
        <span className="xray-hero-ui__dot" />
        <span className="mono" style={{ marginLeft: 8, fontSize: 11, color: "var(--p-muted)" }}>
          cashflow_FY26.xlsx · graph ready
        </span>
      </div>
      <div className="xray-hero-ui__body" style={{ position: "relative" }}>
        <div className="xray-hero-ui__sheet">
          <div className="xray-hero-ui__row">
            <span>A</span>
            <strong>Sheet</strong>
            <strong>Cell</strong>
            <strong>Risk</strong>
          </div>
          <div className="xray-hero-ui__row">
            <span>1</span>
            <span>P&amp;L</span>
            <span>D14</span>
            <span>#REF!</span>
          </div>
          <div className="xray-hero-ui__row xray-hero-ui__row--risk">
            <span>2</span>
            <span>Cash</span>
            <span>F22</span>
            <span>circular</span>
          </div>
          <div className="xray-hero-ui__row">
            <span>3</span>
            <span>Ops</span>
            <span>B8</span>
            <span>cross-file</span>
          </div>
          <div className="xray-hero-ui__row">
            <span>4</span>
            <span>Tax</span>
            <span>H3</span>
            <span>volatile</span>
          </div>
        </div>
        <div className="xray-hero-ui__side">
          <div className="xray-hero-ui__pill">
            <b>72</b>
            <span>workbook health</span>
          </div>
          <div className="xray-hero-ui__pill">
            <b>18</b>
            <span>open risks</span>
          </div>
          <div className="xray-hero-ui__pill">
            <b>4</b>
            <span>patches ready</span>
          </div>
        </div>
      </div>
      <div className="ly-float" style={{ position: "absolute", left: 16, bottom: 16, zIndex: 2 }}>
        <div className="ly-float__row">
          <span className="ly-live">live</span>
          <span className="mono">graph</span>
        </div>
        <div className="ly-float__title">1,842 formula edges mapped</div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { t, lang } = useI18n();
  const [data, setData] = useState<Dash | null>(null);
  const router = useRouter();

  useEffect(() => {
    const load = () =>
      fetch("/api/dashboard")
        .then((r) => r.json())
        .then(setData)
        .catch(() => {});
    load();
    const iv = setInterval(load, 8000);
    return () => clearInterval(iv);
  }, []);

  return (
    <>
      <main id="top">
        {/* hero: split */}
        <section className="hero hero--split bg-halo" data-enter aria-labelledby="hero-h">
          <div className="wrap">
            <div className="hero-text grid hero__grid">
              <div className="hero__text span-5">
                <p className="hero__kicker">
                  <span className="dot" aria-hidden="true" />
                  Every change ships a reverse patch
                </p>
                <h1 id="hero-h">Spreadsheet analysis for finance teams</h1>
                <p className="hero__lead">
                  Scan .xlsx workbooks for broken formulas, circular refs and cross-file links, then apply
                  reversible patches without rewriting the original file.
                </p>
                <div className="btn-row">
                  <Link className="btn btn--primary" href="/analyze">
                    Start a workbook scan
                    <svg className="m-arrow" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Link>
                  <Link className="btn btn--secondary" href="/#how">
                    See how it works
                  </Link>
                </div>
              </div>
              <div className="hero__media span-6 start-7">
                <HeroUi />
              </div>
            </div>
          </div>
        </section>

        <HowItWorks />

        {/* product app-frame */}
        <section className="section" id="product" style={{ ["--h" as string]: 2 }} aria-labelledby="product-h">
          <div className="wrap">
            <div className="section-head">
              <h2 id="product-h">The analysis workbench</h2>
              <p className="measure" style={{ color: "var(--p-muted)", marginTop: 16, fontSize: 16, lineHeight: 1.55 }}>
                One window for the risk list, the formula graph and the patch queue. Accept or undo cell by cell.
              </p>
            </div>
            <div className="app-frame" style={{ marginTop: 48 }} data-m-loop="3.2">
              <aside className="app-frame__rail" aria-hidden="true">
                <div className="rail-item is-on">Overview</div>
                <div className="rail-item">Risks</div>
                <div className="rail-item">Graph</div>
                <div className="rail-item">Patches</div>
                <div className="rail-item">Sheets</div>
                <div className="rail-item">Export</div>
              </aside>
              <div className="app-frame__main">
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, gap: 12 }}>
                  <div>
                    <div className="mono" style={{ fontSize: 12, color: "var(--p-muted)" }}>
                      ANALYSIS · LOCAL COPY IMMUTABLE
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: "var(--display-tracking)" }}>
                      ops_budget_Q3.xlsx
                    </div>
                  </div>
                  <div className="mono" style={{ fontSize: 28, color: "var(--color-ok)", fontWeight: 500 }}>
                    81
                  </div>
                </div>
                <table className="app-frame__table">
                  <thead>
                    <tr>
                      <th>Finding</th>
                      <th>Sheet</th>
                      <th>Cell</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ color: "var(--p-accent)" }}>Broken external link</td>
                      <td>Cash</td>
                      <td>C12</td>
                      <td>Patch ready</td>
                    </tr>
                    <tr>
                      <td>Circular chain (3 cells)</td>
                      <td>Forecast</td>
                      <td>E4</td>
                      <td>Review</td>
                    </tr>
                    <tr>
                      <td>Volatile NOW() in total</td>
                      <td>Summary</td>
                      <td>B2</td>
                      <td>Patch ready</td>
                    </tr>
                    <tr>
                      <td>Empty range in SUM</td>
                      <td>P&amp;L</td>
                      <td>G40</td>
                      <td>Accept</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {/* features */}
        <section className="section ground-surface" id="features" style={{ ["--h" as string]: 1 }} aria-labelledby="features-h">
          <div className="wrap">
            <div className="section-head">
              <h2 id="features-h">Checks the engine runs</h2>
            </div>
            <div className="feat-grid">
              <article className="feat-card m-nolift">
                <div className="feat-card__viz" aria-hidden="true">
                  <div>A1 → B4 → D9</div>
                  <div style={{ marginTop: 8, color: "var(--p-accent)" }}>D9 → A1 · cycle detected</div>
                  <div style={{ marginTop: 18, opacity: 0.7 }}>nodes 1,842 · edges 2,110</div>
                </div>
                <div className="feat-card__body">
                  <h3>Formula dependency graph</h3>
                  <p>Trace every precedent and dependent across sheets and linked workbooks.</p>
                </div>
              </article>
              <article className="feat-card m-nolift">
                <div className="feat-card__viz" aria-hidden="true">
                  <div style={{ display: "flex", gap: 8 }}>
                    <span className="chip" style={{ color: "#fb7185", borderColor: "rgba(251,113,133,.4)", background: "rgba(251,113,133,.08)" }}>
                      critical
                    </span>
                    <span className="chip" style={{ color: "var(--color-warn)", borderColor: "rgba(232,163,23,.4)", background: "rgba(232,163,23,.08)" }}>
                      warning
                    </span>
                  </div>
                  <div style={{ marginTop: 16 }}>#REF! · #DIV/0! · circular · volatile</div>
                </div>
                <div className="feat-card__body">
                  <h3>Risk scoring</h3>
                  <p>Rank findings by severity so the first fix is the one that matters.</p>
                </div>
              </article>
              <article className="feat-card m-nolift">
                <div className="feat-card__viz" aria-hidden="true">
                  <div>+ patch forward · cell D14</div>
                  <div style={{ marginTop: 6 }}>- patch reverse · restore D14</div>
                  <div style={{ marginTop: 18, color: "var(--color-ok)" }}>undo queue: 4</div>
                </div>
                <div className="feat-card__body">
                  <h3>Reversible patches</h3>
                  <p>Every accepted change writes its reverse. Undo is a first-class path.</p>
                </div>
              </article>
              <article className="feat-card m-nolift">
                <div className="feat-card__viz" aria-hidden="true">
                  <div>mode: local · bytes stay on device</div>
                  <div style={{ marginTop: 8 }}>mode: server · worker lease fenced</div>
                </div>
                <div className="feat-card__body">
                  <h3>Local or server scan</h3>
                  <p>Run in the browser for private books, or on the worker for large batches.</p>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* moment: letters-assemble */}
        <section
          className="section"
          id="claim"
          data-moment="letters-assemble"
          data-moment-opts='{"spread":1}'
          style={{ ["--h" as string]: 1 }}
          aria-labelledby="claim-h"
        >
          <div className="wrap">
            <h2 id="claim-h" className="mo-la__type">
              Reverse every patch
            </h2>
            <p className="mo-la__sub">The source workbook is never rewritten in place. Exports are copies with an audit trail.</p>
          </div>
        </section>

        {/* recent work */}
        <section className="section ground-surface" id="work" style={{ ["--h" as string]: 1 }} aria-labelledby="work-h">
          <div className="wrap">
            <div className="section-head">
              <h2 id="work-h">Your recent scans</h2>
            </div>
            <div className="work-grid">
              <div className="panel" style={{ overflow: "hidden" }}>
                {data?.recent?.length ? (
                  <div>
                    {data.recent.slice(0, 6).map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => router.push(`/analysis/${r.id}`)}
                        className="w-full text-left px-4 py-3 flex items-center gap-4 border-b border-[color:color-mix(in_oklab,var(--p-ink)_8%,transparent)] hover:bg-[color:color-mix(in_oklab,var(--p-ink)_4%,transparent)] transition-colors"
                      >
                        <div
                          className="w-10 h-10 rounded border flex items-center justify-center mono text-xs font-medium shrink-0"
                          style={{
                            borderColor: `${healthColor(r.healthScore)}55`,
                            color: healthColor(r.healthScore),
                          }}
                        >
                          {r.healthScore ?? "--"}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{r.name}</div>
                          <div className="text-[12px] text-[color:var(--p-muted)] mono truncate">
                            {relTime(r.createdAt, lang)}
                            {r.formulaCount != null && ` · ${fmtNum(r.formulaCount)} fx`}
                            {r.riskCount != null && r.riskCount > 0 && ` · ${r.riskCount} risks`}
                          </div>
                        </div>
                        <StatusChip status={r.status} t={t} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="px-4 py-16 text-center text-[color:var(--p-muted)] text-sm">
                    No scans yet. Start a workbook scan to see health and risks here.
                  </div>
                )}
              </div>
              <div className="panel p-5">
                <div className="mono text-[12px] text-[color:var(--p-accent)] mb-3">POLICY</div>
                <h3 style={{ fontSize: 22, fontWeight: 500, margin: "0 0 10px", letterSpacing: "var(--display-tracking)" }}>
                  Originals stay immutable
                </h3>
                <p style={{ margin: 0, color: "var(--p-muted)", fontSize: 16, lineHeight: 1.55 }}>
                  Uploads are treated as read-only. Patches land on derived copies. Local mode keeps bytes on the device.
                </p>
                <div className="mt-6 grid grid-cols-2 gap-3">
                  <div className="xray-hero-ui__pill">
                    <b>{fmtNum(data?.stats.totalAnalyses ?? 0)}</b>
                    <span>analyses</span>
                  </div>
                  <div className="xray-hero-ui__pill">
                    <b>{fmtNum(data?.stats.applied ?? 0)}</b>
                    <span>patches applied</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* moment: liquid-type */}
        <section className="section" id="statement" style={{ ["--h" as string]: 1 }} aria-labelledby="statement-h">
          <div className="wrap">
            <h2
              id="statement-h"
              className="mo-lt__type"
              data-moment="liquid-type"
              data-moment-opts='{"strength":1}'
            >
              Built for the ugly workbook
            </h2>
            <p className="mo-la__sub">
              Shared drives, linked files, decade-old macros. The engine is deterministic: same book, same findings.
            </p>
          </div>
        </section>
      </main>

      <footer className="footer closing footer--dark" id="contact">
        <div className="wrap">
          <div className="closing__cta close--type">
            <h2>Scan the next workbook</h2>
            <p style={{ color: "var(--p-muted)", maxWidth: "42ch" }}>
              Upload a file or run a sample book. You get a health score, a risk list and a reversible patch queue.
            </p>
            <Link className="btn btn--primary btn--xl" href="/analyze">
              Start a workbook scan
              <svg className="m-arrow" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </div>
          <div className="closing__links">
            <div className="grid">
              <div className="footer__col span-4">
                <p className="t-label">Product</p>
                <ul>
                  <li>
                    <Link href="/#how">How it works</Link>
                  </li>
                  <li>
                    <Link href="/#product">Workbench</Link>
                  </li>
                  <li>
                    <Link href="/analyze">New analysis</Link>
                  </li>
                </ul>
              </div>
              <div className="footer__col span-4">
                <p className="t-label">Workspace</p>
                <ul>
                  <li>
                    <Link href="/#work">Your scans</Link>
                  </li>
                  <li>
                    <Link href="/settings">Rules &amp; settings</Link>
                  </li>
                </ul>
              </div>
              <div className="footer__col span-4">
                <p className="t-label">Contact</p>
                <ul>
                  <li>
                    <a href="mailto:audit@xray-excel.example">audit@xray-excel.example</a>
                  </li>
                </ul>
              </div>
            </div>
            <div className="footer__legal">
              <span className="xray-mark" aria-hidden="true" style={{ width: 22, height: 22 }} />
              <span>X-RAY://EXCEL</span>
              <span style={{ color: "var(--p-muted)" }}>Deterministic spreadsheet analysis · originals immutable</span>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
