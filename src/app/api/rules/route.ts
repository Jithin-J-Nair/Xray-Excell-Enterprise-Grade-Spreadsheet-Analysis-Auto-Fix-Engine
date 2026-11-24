import { NextRequest, NextResponse } from "next/server";
import { TOOLS, AUTOFIX_TOOLS } from "@/lib/excel/transform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Built-in rule registry only. Custom rule definitions are not executed by
 * applyTransforms; registration is intentionally disabled (honest API surface).
 */
export async function GET() {
  return NextResponse.json({
    engine: "X-RAY://EXCEL v2",
    deterministic: true,
    autoFix: AUTOFIX_TOOLS,
    customRulesExecutable: false,
    rules: TOOLS.map((t) => ({
      id: t.id,
      group: t.group,
      name: t.name,
      description: t.desc,
      safeDefault: t.safeDefault,
      autoFix: t.autoFix,
      targets: t.targets,
    })),
    customRules: [],
  });
}

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      errorCode: "CUSTOM_RULES_NOT_IMPLEMENTED",
      message:
        "Custom rules are intentionally not supported in this release. Only the built-in T001–T013 registry runs in preview/apply.",
      retryable: false,
    },
    { status: 501 }
  );
}
