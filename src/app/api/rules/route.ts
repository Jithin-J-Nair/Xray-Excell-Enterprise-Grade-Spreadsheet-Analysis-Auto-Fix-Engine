import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { customRules } from "@/db/schema";
import { desc } from "drizzle-orm";
import { TOOLS, AUTOFIX_TOOLS } from "@/lib/excel/transform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const customs = await db.select().from(customRules).orderBy(desc(customRules.createdAt)).limit(100);
  return NextResponse.json({
    engine: "X-RAY://EXCEL v2",
    deterministic: true,
    autoFix: AUTOFIX_TOOLS,
    rules: TOOLS.map((t) => ({
      id: t.id,
      group: t.group,
      name: t.name,
      description: t.desc,
      safeDefault: t.safeDefault,
      autoFix: t.autoFix,
      targets: t.targets,
    })),
    customRules: customs.map((c) => ({ id: c.id, name: c.name, group: c.groupName, description: c.description, definition: c.definition, enabled: c.enabled, createdAt: c.createdAt })),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { name?: string; group?: string; description?: string; definition?: unknown };
    if (!body.name || typeof body.name !== "string" || body.name.length > 120) {
      return NextResponse.json({ errorCode: "BAD_RULE", message: "name (<=120 chars) is required", retryable: false }, { status: 400 });
    }
    if (body.definition === undefined || typeof body.definition !== "object" || body.definition === null) {
      return NextResponse.json({ errorCode: "BAD_DEFINITION", message: "definition must be a JSON object", retryable: false }, { status: 400 });
    }
    const [row] = await db
      .insert(customRules)
      .values({
        name: body.name,
        groupName: typeof body.group === "string" ? body.group : "custom",
        description: typeof body.description === "string" ? body.description.slice(0, 500) : "",
        definition: body.definition,
      })
      .returning();
    return NextResponse.json({ id: row.id, status: "created", rule: row });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ errorCode: "RULE_CREATE_FAILED", message, retryable: true }, { status: 500 });
  }
}
