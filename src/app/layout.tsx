import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import "./globals.css";
import { I18nProvider } from "@/components/i18n";
import { Header } from "@/components/header";
import { Toaster } from "@/components/toast";
import { TasteRuntime } from "@/components/taste-runtime";

export const metadata: Metadata = {
  title: "Spreadsheet analysis for finance teams — X-RAY://EXCEL",
  description:
    "Scan Excel workbooks for broken formulas, circular refs and cross-file links, then apply reversible patches. Originals stay immutable.",
  other: {
    "page-type": "software",
    "site-kind": "software",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-type="software"
      data-radius="sharp"
      data-buttons="arrow"
      data-motion=""
      data-ground="sage"
      data-mode="dark"
    >
      <head>
        <meta name="page-type" content="software" />
        <meta name="site-kind" content="software" />
        <meta name="theme-color" content="#18191b" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wdth,wght@75..100,400..700&family=DM+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <link rel="stylesheet" href="/assets/system.css" />
        <link rel="stylesheet" href="/assets/ui/cards.css" />
        <link rel="stylesheet" href="/assets/motion/motion.css" />
        <link rel="stylesheet" href="/assets/backgrounds/backgrounds.css" />
        <link rel="stylesheet" href="/assets/layout/layout.css" />
        <link rel="stylesheet" href="/assets/icons/icon.css" />
        <link rel="stylesheet" href="/assets/xray-theme.css" />
        <link rel="modulepreload" href="/assets/moments/moments.js" />
        <link rel="modulepreload" href="/assets/moments/lib.js" />
        <link rel="modulepreload" href="/assets/moments/letters-assemble/moment.js" />
        <link rel="modulepreload" href="/assets/moments/liquid-type/moment.js" />
        <script
          dangerouslySetInnerHTML={{
            __html: `document.documentElement.classList.add('m-enter','mo-js');setTimeout(function(){document.documentElement.classList.add('m-enter-done')},700);setTimeout(function(){document.documentElement.classList.add('mo-safe')},2500);`,
          }}
        />
      </head>
      <body className="xray-page antialiased">
        {/* deal: graphite-safety-orange · instrument · split · sage · painterly · liquid-type + letters-assemble · nav-centre · footer-dark · close-word · surface-pairs · arrow · arc · sharp */}
        <I18nProvider>
          <TasteRuntime />
          <Header />
          {children}
          <Toaster />
        </I18nProvider>
        <Script src="/assets/motion/motion.js" type="module" strategy="afterInteractive" />
        <Script src="/assets/layout/layout.js" type="module" strategy="afterInteractive" />
        <Script src="/assets/system.js" type="module" strategy="afterInteractive" />
        <Script src="/assets/effects/fx.js" type="module" strategy="afterInteractive" data-fx-auto="" />
        <Script src="/assets/moments/moments.js" type="module" strategy="afterInteractive" />
      </body>
    </html>
  );
}
