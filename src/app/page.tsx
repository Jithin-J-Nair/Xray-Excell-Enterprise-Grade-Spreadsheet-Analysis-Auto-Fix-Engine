"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HowItWorks } from "@/components/home/how-it-works";
import { HugeCta } from "@/components/home/huge-cta";
import { SheetScan } from "@/components/home/sheet-scan";
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

function WorkbenchDemo() {
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const id = window.setInterval(() => setAccepted((v) => !v), 2800);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="app-frame" data-m-loop="2.8">
      <aside className="app-frame__rail" aria-hidden="true">
        <div className="rail-item is-on">Overview</div>
        <div className="rail-item">Risks</div>
        <div className="rail-item">Graph</div>
        <div className="rail-item">Patches</div>
        <div className="rail-item">Sheets</div>
        <div className="rail-item">Export</div>
      </aside>
      <div className="app-frame__main">
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, gap: 12, alignItems: "flex-start" }}>
          <div>
            <div className="mono" style={{ fontSize: 12, color: "var(--p-muted)" }}>
              ANALYSIS · LOCAL COPY IMMUTABLE
            </div>
            <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: "var(--display-tracking)" }}>ops_budget_Q3.xlsx</div>
          </div>
          <div className="mono" style={{ fontSize: 28, color: "var(--color-ok)", fontWeight: 500 }}>
            {accepted ? "86" : "81"}
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
            <tr className={accepted ? "row-fixed" : "row-risk"}>
              <td>{accepted ? "External link restored" : "Broken external link"}</td>
              <td>Cash</td>
              <td>C12</td>
              <td>
                <span className={`patch-btn ${accepted ? "is-done" : "is-pulse"}`}>{accepted ? "Undone available" : "Accept patch"}</span>
              </td>
            </tr>
            <tr>
              <td>Circular chain (3 cells)</td>
              <td>Forecast</td>
              <td>E4</td>
              <td>
                <span className="patch-btn">Review</span>
              </td>
            </tr>
            <tr>
              <td>Volatile NOW() in total</td>
              <td>Summary</td>
              <td>B2</td>
              <td>
                <span className="patch-btn">Accept patch</span>
              </td>
            </tr>
            <tr>
              <td>Empty range in SUM</td>
              <td>P&amp;L</td>
              <td>G40</td>
              <td>
                <span className="patch-btn">Accept patch</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div className="workbench-diff mono" aria-hidden="true">
          <div className="workbench-diff__minus">− =[old.xlsx]Cash!C12</div>
          <div className="workbench-diff__plus">+ =&apos;[ops.xlsx]Cash&apos;!C12</div>
        </div>
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
                  Scan .xlsx workbooks for broken formulas, circular refs and cross-file links, then apply reversible
                  patches without rewriting the original file.
                </p>
                <div className="btn-row">
                  <Link className="btn btn--primary" href="/analyze">
                    Start a workbook scan
                    <svg className="m-arrow" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
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
                  <Link className="btn btn--secondary" href="/#how">
                    See how it works
                  </Link>
                </div>
              </div>
              <div className="hero__media span-6 xray-col-start-7" data-visual="">
                <div
                  data-fx="painterly-landscape"
                  data-fx-seed="11"
                  data-fx-palette='{"bg":"#18191b","surface":"#222427","ink":"#eff0f1","muted":"#9c9ea3","accent":"#ff4a1f"}'
                  data-fx-params='{"blur":0.7,"brush":0.45,"slope":12,"hillY":0.18,"horizon":0.55,"calm":0.35,"calmX":0.55,"calmY":0.4,"drift":0.02,"side":1}'
                  className="hero-fx"
                  aria-hidden="true"
                />
                <SheetScan />
              </div>
            </div>
          </div>
        </section>

        <HowItWorks />

        <section className="section" id="product" aria-labelledby="product-h">
          <div className="wrap">
            <div className="section-head">
              <h2 id="product-h">The analysis workbench</h2>
              <p className="measure" style={{ color: "var(--p-muted)", marginTop: 16, fontSize: 16, lineHeight: 1.55 }}>
                One window for the risk list, the formula graph and the patch queue. Accept or undo cell by cell.
              </p>
            </div>
            <div style={{ marginTop: 48 }}>
              <WorkbenchDemo />
            </div>
          </div>
        </section>

        <section className="section ground-surface" id="features" aria-labelledby="features-h">
          <div className="wrap">
            <div className="section-head">
              <h2 id="features-h">Checks the engine runs</h2>
              <p className="measure" style={{ color: "var(--p-muted)", marginTop: 16, fontSize: 16, lineHeight: 1.55 }}>
                Four passes on every upload: the graph, the risk list, the patch queue, and the scan mode.
              </p>
            </div>
            <div className="feat-grid">
              <article className="feat-card m-nolift">
                <div className="feat-card__viz feat-graph" aria-hidden="true">
                  <span className="feat-graph__n">A1</span>
                  <span className="feat-graph__line" />
                  <span className="feat-graph__n">B4</span>
                  <span className="feat-graph__line" />
                  <span className="feat-graph__n is-hot">D9</span>
                  <span className="feat-graph__cycle">cycle</span>
                </div>
                <div className="feat-card__body">
                  <h3>Formula dependency graph</h3>
                  <p>Trace every precedent and dependent across sheets and linked workbooks.</p>
                </div>
              </article>
              <article className="feat-card m-nolift">
                <div className="feat-card__viz feat-risks" aria-hidden="true">
                  <span className="chip chip-crit">critical</span>
                  <span className="chip chip-warn">warning</span>
                  <div className="feat-risks__list mono">#REF! · circular · volatile · #DIV/0!</div>
                </div>
                <div className="feat-card__body">
                  <h3>Risk scoring</h3>
                  <p>Rank findings by severity so the first fix is the one that matters.</p>
                </div>
              </article>
              <article className="feat-card m-nolift">
                <div className="feat-card__viz feat-patch" aria-hidden="true">
                  <div className="feat-patch__row is-minus">− cell D14 · restore</div>
                  <div className="feat-patch__row is-plus">+ cell D14 · forward</div>
                  <div className="feat-patch__q mono">undo queue: 4</div>
                </div>
                <div className="feat-card__body">
                  <h3>Reversible patches</h3>
                  <p>Every accepted change writes its reverse. Undo is a first-class path.</p>
                </div>
              </article>
              <article className="feat-card m-nolift">
                <div className="feat-card__viz feat-modes" aria-hidden="true">
                  <div className="feat-modes__pill is-on">local · on device</div>
                  <div className="feat-modes__pill">server · worker fenced</div>
                </div>
                <div className="feat-card__body">
                  <h3>Local or server scan</h3>
                  <p>Run in the browser for private books, or on the worker for large batches.</p>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section
          className="section"
          id="claim"
          data-moment="letters-assemble"
          data-moment-opts='{"spread":1}'
          aria-labelledby="claim-h"
        >
          <div className="wrap claim-layout">
            <div>
              <h2 id="claim-h" className="mo-la__type">
                Reverse every patch
              </h2>
              <p className="mo-la__sub">The source workbook is never rewritten in place. Exports are copies with an audit trail.</p>
            </div>
            <ul className="claim-facts">
              <li>
                <span className="claim-facts__k mono">01</span>
                <div>
                  <strong>Forward and reverse together</strong>
                  <p>Every accepted change writes its undo patch in the same pass.</p>
                </div>
              </li>
              <li>
                <span className="claim-facts__k mono">02</span>
                <div>
                  <strong>Source stays read-only</strong>
                  <p>Patches land on a derived copy. The upload is never rewritten in place.</p>
                </div>
              </li>
              <li>
                <span className="claim-facts__k mono">03</span>
                <div>
                  <strong>Audit on the export</strong>
                  <p>Health, risks and applied tools travel with the downloaded workbook.</p>
                </div>
              </li>
            </ul>
          </div>
        </section>

        <section className="section ground-surface" id="work" aria-labelledby="work-h">
          <div className="wrap">
            <div className="section-head">
              <h2 id="work-h">Your recent scans</h2>
              <p className="measure" style={{ color: "var(--p-muted)", marginTop: 16, fontSize: 16, lineHeight: 1.55 }}>
                Health, risk count and status for the last workbooks you opened in this workspace.
              </p>
            </div>
            <div className="work-grid">
              <div className="panel work-list" style={{ overflow: "hidden" }}>
                {data?.recent?.length ? (
                  <div>
                    {data.recent.slice(0, 6).map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => router.push(`/analysis/${r.id}`)}
                        className="work-row"
                      >
                        <div
                          className="work-row__score mono"
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
                  <div className="work-empty">
                    <p className="work-empty__title">No scans yet</p>
                    <p className="work-empty__body">Start a workbook scan to land health scores and risks in this list.</p>
                    <Link className="btn btn--primary" href="/analyze">
                      Start a workbook scan
                    </Link>
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

      </main>

      <footer className="footer closing footer--dark" id="go" aria-labelledby="go-h">
        <div className="wrap">
          <HugeCta />
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
