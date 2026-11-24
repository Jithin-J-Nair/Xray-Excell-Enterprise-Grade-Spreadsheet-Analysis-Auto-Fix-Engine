import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { I18nProvider } from "@/components/i18n";
import { Header } from "@/components/header";
import { Toaster } from "@/components/toast";
import { TasteRuntime } from "@/components/taste-runtime";

export const metadata: Metadata = {
  title: "Clear spreadsheet checks for finance teams — X-RAY://EXCEL",
  description:
    "Find broken formulas, messy text, and risky links. Preview every fix, keep what you want, download a copy. Your original stays safe.",
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
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
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
      </head>
      <body className="xray-page antialiased">
        {/* deal: graphite-safety-orange · instrument · split · sage · painterly · liquid-type + letters-assemble · nav-centre · footer-dark · close-word · surface-pairs · arrow · arc · sharp */}
        <I18nProvider>
          <TasteRuntime />
          <Header />
          {children}
          <Toaster />
        </I18nProvider>
      </body>
    </html>
  );
}
