import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET() { const templates = await db.agentTemplate.findMany({ orderBy: [{ isBuiltin: "desc" }, { name: "asc" }] }); return NextResponse.json({ templates, count: templates.length }); }
export async function POST(req: NextRequest) {
  const { key, name, description, systemPrompt, toolAllowlist, defaultContext } = await req.json();
  if (!key || !name || !description || !systemPrompt) return NextResponse.json({ error: "key, name, description, systemPrompt required" }, { status: 400 });
  const existing = await db.agentTemplate.findUnique({ where: { key } });
  if (existing) return NextResponse.json({ error: "key already exists" }, { status: 409 });
  const template = await db.agentTemplate.create({ data: { key, name, description, systemPrompt, toolAllowlist: JSON.stringify(toolAllowlist ?? []), defaultContext: JSON.stringify(defaultContext ?? {}), isBuiltin: false } });
  return NextResponse.json({ template });
}
