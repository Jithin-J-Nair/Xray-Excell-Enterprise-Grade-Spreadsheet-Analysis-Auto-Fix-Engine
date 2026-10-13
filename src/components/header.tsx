"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ScanSearch, LayoutDashboard, Upload, Settings2, Languages } from "lucide-react";
import { useI18n } from "@/components/i18n";

export function Header() {
  const { t, lang, setLang } = useI18n();
  const pathname = usePathname();
  const items = [
    { href: "/", label: t("nav.dashboard"), icon: LayoutDashboard },
    { href: "/analyze", label: t("nav.new"), icon: Upload },
    { href: "/settings", label: t("nav.settings"), icon: Settings2 },
  ];
  return (
    <header className="sticky top-0 z-50 border-b border-edge/70 bg-void/80 backdrop-blur-md">
      <div className="max-w-[1400px] mx-auto px-5 h-14 flex items-center gap-6">
        <Link href="/" className="flex items-center gap-2.5 group">
          <span className="relative flex items-center justify-center w-8 h-8 rounded-lg border border-accent/40 bg-accent/10">
            <ScanSearch size={17} className="text-accent" />
          </span>
          <span className="mono font-bold tracking-tight text-[15px]">
            <span className="text-accent glow-text">X-RAY</span>
            <span className="text-dim">://</span>
            <span>EXCEL</span>
            <span className="ml-1.5 text-[10px] text-dim font-normal">v2</span>
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {items.map((it) => {
            const active = it.href === "/" ? pathname === "/" : pathname.startsWith(it.href);
            return (
              <Link
                key={it.href}
                href={it.href}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${
                  active ? "bg-accent/10 text-accent border border-accent/25" : "text-dim hover:text-txt hover:bg-white/5 border border-transparent"
                }`}
              >
                <it.icon size={14} />
                {it.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden md:flex items-center gap-1.5 text-[10px] mono text-ok border border-ok/30 bg-ok/5 rounded-full px-2.5 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-ok pulse-dot" />
            ENGINE ONLINE
          </div>
          <button
            onClick={() => setLang(lang === "en" ? "jp" : "en")}
            className="btn-ghost btn !py-1.5 !px-3 text-xs mono"
            aria-label="Toggle language"
          >
            <Languages size={13} />
            {lang === "en" ? "EN / 日本語" : "日本語 / EN"}
          </button>
        </div>
      </div>
    </header>
  );
}
