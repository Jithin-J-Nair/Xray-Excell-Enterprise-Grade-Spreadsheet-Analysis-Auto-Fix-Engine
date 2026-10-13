import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { I18nProvider } from "@/components/i18n";
import { Header } from "@/components/header";
import { Toaster } from "@/components/toast";

export const metadata: Metadata = {
  title: "X-RAY://EXCEL — Enterprise Spreadsheet Auditor",
  description:
    "Static analysis, deterministic refactoring and data cleaning for spreadsheets. Dependency graphs, risk scoring, reversible patches, bilingual reports.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <I18nProvider>
          <div className="min-h-screen flex flex-col">
            <Header />
            <main className="flex-1">{children}</main>
            <footer className="border-t border-edge/60 py-5 text-center text-[11px] text-dim mono">
              X-RAY://EXCEL v2 · deterministic engine · originals are immutable · every change ships a reverse patch
            </footer>
          </div>
        </I18nProvider>
      </body>
    </html>
  );
}
