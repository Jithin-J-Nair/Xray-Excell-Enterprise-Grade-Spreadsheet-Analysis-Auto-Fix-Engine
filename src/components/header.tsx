"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Languages } from "lucide-react";
import { useI18n } from "@/components/i18n";
import { BrandLogo } from "@/components/brand-logo";

export function Header() {
  const { t, lang, setLang } = useI18n();
  const pathname = usePathname();
  const marketing = pathname === "/";

  const items = marketing
    ? [
        { href: "/#how", label: t("nav.how") },
        { href: "/#product", label: t("nav.workbench") },
        { href: "/#features", label: t("nav.features") },
        { href: "/#go", label: t("nav.fixit") },
      ]
    : [
        { href: "/", label: t("nav.dashboard") },
        { href: "/analyze", label: t("nav.new") },
        { href: "/settings", label: t("nav.settings") },
      ];

  return (
    <header className="xray-nav">
      <div className="xray-nav__bar">
        <a className="skip-link" href="#top">
          {t("nav.skip")}
        </a>
        <BrandLogo />
        <nav className="xray-nav__links" aria-label={t("nav.main")}>
          {items.map((it) => {
            const active =
              it.href === "/"
                ? pathname === "/"
                : it.href.startsWith("/#")
                  ? false
                  : pathname.startsWith(it.href);
            return (
              <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined}>
                {it.label}
              </Link>
            );
          })}
        </nav>
        <div className="xray-nav__actions">
          <div
            className="xray-engine"
            title={t("nav.engine.online")}
            style={{
              color: "var(--color-ok)",
              border: "1px solid color-mix(in oklab, var(--color-ok) 35%, transparent)",
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: "var(--color-ok)" }} />
            <span className="xray-engine__label">{t("nav.online")}</span>
          </div>
          <button
            type="button"
            onClick={() => setLang(lang === "en" ? "jp" : "en")}
            className="btn btn--secondary xray-lang"
            aria-label={t("common.language")}
          >
            <Languages size={13} />
            <span>{lang === "en" ? "EN" : "JP"}</span>
          </button>
          <Link href="/analyze" className="btn btn--primary xray-cta">
            {t("home.cta.scan")}
          </Link>
        </div>
      </div>
    </header>
  );
}
