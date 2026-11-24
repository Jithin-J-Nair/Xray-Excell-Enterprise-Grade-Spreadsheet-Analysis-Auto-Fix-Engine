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
  const { t } = useI18n();
  const [kept, setKept] = useState(true);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const id = window.setInterval(() => setKept((v) => !v), 2800);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="app-frame" data-m-loop="2.8">
      <aside className="app-frame__rail" aria-hidden="true">
        <div className="rail-item is-on">{t("an.tabs.overview")}</div>
        <div className="rail-item">{t("an.tabs.risks")}</div>
        <div className="rail-item">{t("an.tabs.graph")}</div>
        <div className="rail-item">{t("an.tabs.workbench")}</div>
        <div className="rail-item">{t("an.tabs.sheets")}</div>
        <div className="rail-item">{t("an.tabs.export")}</div>
      </aside>
      <div className="app-frame__main">
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, gap: 12, alignItems: "flex-start" }}>
          <div>
            <div className="mono" style={{ fontSize: 12, color: "var(--p-muted)" }}>
              {t("home.demo.example")}
            </div>
            <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: "var(--display-tracking)" }}>ops_budget_Q3.xlsx</div>
          </div>
          <div className="mono" style={{ fontSize: 28, color: "var(--color-ok)", fontWeight: 500 }}>
            {kept ? "86" : "81"}
          </div>
        </div>
        <table className="app-frame__table">
          <thead>
            <tr>
              <th>{t("home.demo.keep")}</th>
              <th>{t("home.demo.issue")}</th>
              <th>{t("home.demo.sheet")}</th>
              <th>{t("home.demo.cell")}</th>
              <th>{t("home.demo.fix")}</th>
            </tr>
          </thead>
          <tbody>
            <tr className={kept ? "row-fixed" : "row-risk"}>
              <td>
                <span className={`patch-btn ${kept ? "is-done" : "is-pulse"}`}>{kept ? t("home.demo.kept") : t("home.demo.skipped")}</span>
              </td>
              <td>{t("risk.WHITESPACE")}</td>
              <td>Cash</td>
              <td>A12</td>
              <td>{t("tool.T007.name")}</td>
            </tr>
            <tr>
              <td>
                <span className="patch-btn">{t("home.demo.kept")}</span>
              </td>
              <td>{t("risk.UNICODE_FULLWIDTH")}</td>
              <td>Forecast</td>
              <td>E4</td>
              <td>{t("tool.T009.name")}</td>
            </tr>
            <tr>
              <td>
                <span className="patch-btn">{t("home.demo.review")}</span>
              </td>
              <td>{t("risk.CIRCULAR_REF")}</td>
              <td>Summary</td>
              <td>B2</td>
              <td>{t("tool.T012.name")}</td>
            </tr>
            <tr>
              <td>
                <span className="patch-btn">{t("home.demo.review")}</span>
              </td>
              <td>{t("risk.EXTERNAL_LINK")}</td>
              <td>P&amp;L</td>
              <td>G40</td>
              <td>{t("tool.T003.name")}</td>
            </tr>
          </tbody>
        </table>
        <div className="workbench-diff mono" aria-hidden="true">
          <div className="workbench-diff__minus">− &quot;  Cash total  &quot;</div>
          <div className="workbench-diff__plus">+ &quot;Cash total&quot;</div>
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
                  {t("home.kicker")}
                </p>
                <h1 id="hero-h">{t("home.hero.h1")}</h1>
                <p className="hero__lead">{t("home.hero.lead")}</p>
                <div className="btn-row">
                  <Link className="btn btn--primary" href="/analyze">
                    {t("home.cta.scan")}
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
                    {t("home.cta.how")}
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
              <h2 id="product-h">{t("home.product.h2")}</h2>
              <p className="measure" style={{ color: "var(--p-muted)", marginTop: 16, fontSize: 16, lineHeight: 1.55 }}>
                {t("home.product.lead")}
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
              <h2 id="features-h">{t("home.features.h2")}</h2>
              <p className="measure" style={{ color: "var(--p-muted)", marginTop: 16, fontSize: 16, lineHeight: 1.55 }}>
                {t("home.features.lead")}
              </p>
            </div>
            <div className="feat-grid">
              <article className="feat-card m-nolift">
                <div className="feat-card__viz feat-patch" aria-hidden="true">
                  <div className="feat-patch__row is-minus">− 全角１２３</div>
                  <div className="feat-patch__row is-plus">+ 123</div>
                  <div className="feat-patch__q mono">T007 · T009 · T010 · T013</div>
                </div>
                <div className="feat-card__body">
                  <h3>{t("home.feat.hygiene.title")}</h3>
                  <p>{t("home.feat.hygiene.body")}</p>
                </div>
              </article>
              <article className="feat-card m-nolift">
                <div className="feat-card__viz feat-graph" aria-hidden="true">
                  <span className="feat-graph__n">A1</span>
                  <span className="feat-graph__line" />
                  <span className="feat-graph__n">Book2</span>
                  <span className="feat-graph__line" />
                  <span className="feat-graph__n is-hot">D9</span>
                  <span className="feat-graph__cycle">cross-file</span>
                </div>
                <div className="feat-card__body">
                  <h3>{t("home.feat.map.title")}</h3>
                  <p>{t("home.feat.map.body")}</p>
                </div>
              </article>
              <article className="feat-card m-nolift">
                <div className="feat-card__viz feat-risks" aria-hidden="true">
                  <span className="chip chip-warn">B2 100→105</span>
                  <span className="chip chip-crit">C4 #N/A→0</span>
                  <div className="feat-risks__list mono">recalc · value diff · copy only</div>
                </div>
                <div className="feat-card__body">
                  <h3>{t("home.feat.recalc.title")}</h3>
                  <p>{t("home.feat.recalc.body")}</p>
                </div>
              </article>
              <article className="feat-card m-nolift">
                <div className="feat-card__viz feat-modes" aria-hidden="true">
                  <div className="feat-modes__pill is-on">patch.json · reverse log</div>
                  <div className="feat-modes__pill">経理 · 予算 · 請求</div>
                </div>
                <div className="feat-card__body">
                  <h3>{t("home.feat.audit.title")}</h3>
                  <p>{t("home.feat.audit.body")}</p>
                </div>
              </article>
              <article className="feat-card m-nolift">
                <div className="feat-card__viz feat-modes" aria-hidden="true">
                  <div className="feat-modes__pill is-on">{t("pack.keiri.name")}</div>
                  <div className="feat-modes__pill">{t("pack.yosan.name")}</div>
                  <div className="feat-modes__pill">{t("pack.seikyu.name")}</div>
                </div>
                <div className="feat-card__body">
                  <h3>{t("home.feat.packs.title")}</h3>
                  <p>{t("home.feat.packs.body")}</p>
                </div>
              </article>
              <article className="feat-card m-nolift">
                <div className="feat-card__viz feat-modes" aria-hidden="true">
                  <div className="feat-modes__pill is-on">private · on this device</div>
                  <div className="feat-modes__pill">server · for larger files</div>
                </div>
                <div className="feat-card__body">
                  <h3>{t("up.mode")}</h3>
                  <p>{t("dash.local.desc")}</p>
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
                {t("home.claim.h2")}
              </h2>
              <p className="mo-la__sub">{t("home.claim.sub")}</p>
            </div>
            <ul className="claim-facts">
              <li>
                <span className="claim-facts__k mono">01</span>
                <div>
                  <strong>{t("home.claim.1.title")}</strong>
                  <p>{t("home.claim.1.body")}</p>
                </div>
              </li>
              <li>
                <span className="claim-facts__k mono">02</span>
                <div>
                  <strong>{t("home.claim.2.title")}</strong>
                  <p>{t("home.claim.2.body")}</p>
                </div>
              </li>
              <li>
                <span className="claim-facts__k mono">03</span>
                <div>
                  <strong>{t("home.claim.3.title")}</strong>
                  <p>{t("home.claim.3.body")}</p>
                </div>
              </li>
            </ul>
          </div>
        </section>

        <section className="section ground-surface" id="work" aria-labelledby="work-h">
          <div className="wrap">
            <div className="section-head">
              <h2 id="work-h">{t("home.work.h2")}</h2>
              <p className="measure" style={{ color: "var(--p-muted)", marginTop: 16, fontSize: 16, lineHeight: 1.55 }}>
                {t("home.work.lead")}
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
                    <p className="work-empty__title">{t("home.work.empty.title")}</p>
                    <p className="work-empty__body">{t("home.work.empty.body")}</p>
                    <Link className="btn btn--primary" href="/analyze">
                      {t("home.cta.scan")}
                    </Link>
                  </div>
                )}
              </div>
              <div className="panel p-5">
                <div className="mono text-[12px] text-[color:var(--p-accent)] mb-3">{t("home.policy.kicker")}</div>
                <h3 style={{ fontSize: 22, fontWeight: 500, margin: "0 0 10px", letterSpacing: "var(--display-tracking)" }}>
                  {t("home.policy.title")}
                </h3>
                <p style={{ margin: 0, color: "var(--p-muted)", fontSize: 16, lineHeight: 1.55 }}>
                  {t("home.policy.body")}
                </p>
                <div className="mt-6 grid grid-cols-2 gap-3">
                  <div className="xray-hero-ui__pill">
                    <b>{fmtNum(data?.stats.totalAnalyses ?? 0)}</b>
                    <span>{t("home.policy.analyses")}</span>
                  </div>
                  <div className="xray-hero-ui__pill">
                    <b>{fmtNum(data?.stats.applied ?? 0)}</b>
                    <span>{t("home.policy.patches")}</span>
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
                <p className="t-label">{t("home.footer.product")}</p>
                <ul>
                  <li>
                    <Link href="/#how">{t("home.footer.how")}</Link>
                  </li>
                  <li>
                    <Link href="/#product">{t("home.footer.workbench")}</Link>
                  </li>
                  <li>
                    <Link href="/analyze">{t("home.footer.new")}</Link>
                  </li>
                </ul>
              </div>
              <div className="footer__col span-4">
                <p className="t-label">{t("home.footer.workspace")}</p>
                <ul>
                  <li>
                    <Link href="/#work">{t("home.footer.scans")}</Link>
                  </li>
                  <li>
                    <Link href="/settings">{t("home.footer.settings")}</Link>
                  </li>
                </ul>
              </div>
              <div className="footer__col span-4">
                <p className="t-label">{t("home.footer.contact")}</p>
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
              <span style={{ color: "var(--p-muted)" }}>{t("home.footer.legal")}</span>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
