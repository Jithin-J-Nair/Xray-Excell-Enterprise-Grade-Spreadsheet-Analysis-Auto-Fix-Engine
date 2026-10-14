import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

/** Constant-time comparison for configured shared credentials. */
function secureEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Exported separately so credential parsing can be tested without HTTP setup. */
export function isValidBasicAuth(
  header: string | null,
  expectedUser: string,
  expectedPassword: string
): boolean {
  if (!header || !expectedUser || !expectedPassword) return false;
  const match = /^Basic\s+([A-Za-z0-9+/]+={0,2})$/i.exec(header);
  if (!match) return false;

  let decoded: string;
  try {
    decoded = Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return false;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  return (
    secureEqual(decoded.slice(0, separator), expectedUser) &&
    secureEqual(decoded.slice(separator + 1), expectedPassword)
  );
}

export function productionAuthIsMissing(
  nodeEnv: string | undefined,
  username: string | undefined,
  password: string | undefined
): boolean {
  return nodeEnv === "production" && (!username || !password);
}

export function proxy(request: NextRequest) {
  // Health checks expose only database readiness and must remain probeable.
  if (request.nextUrl.pathname === "/api/health") return NextResponse.next();

  const username = process.env.XRAY_BASIC_AUTH_USER;
  const password = process.env.XRAY_BASIC_AUTH_PASSWORD;

  // Fail closed in production: a forgotten auth configuration must not make
  // workbook APIs and stored files publicly accessible.
  if (productionAuthIsMissing(process.env.NODE_ENV, username, password)) {
    return NextResponse.json(
      { errorCode: "AUTH_NOT_CONFIGURED", message: "Server access protection is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Developer convenience only. Production always requires both variables.
  if (!username || !password) return NextResponse.next();

  if (isValidBasicAuth(request.headers.get("authorization"), username, password)) {
    return NextResponse.next();
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="X-RAY Excel", charset="UTF-8"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
