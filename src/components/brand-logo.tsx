import Link from "next/link";

export function BrandLogo({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} className="xray-nav__logo" aria-label="X-RAY Excel home">
      <span className="xray-mark" aria-hidden="true" />
      <span>
        X-RAY
        {!compact && <span style={{ color: "var(--p-muted)", fontWeight: 400 }}>://EXCEL</span>}
      </span>
    </Link>
  );
}
