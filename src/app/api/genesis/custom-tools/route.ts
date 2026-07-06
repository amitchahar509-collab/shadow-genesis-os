import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET() { const tools = await db.customTool.findMany({ orderBy: [{ isBuiltin: "desc" }, { name: "asc" }] }); return NextResponse.json({ tools }); }
export async function POST(req: NextRequest) {
  const { key, name, description, operations, permissions } = await req.json();
  if (!key || !name || !description) return NextResponse.json({ error: "key, name, description required" }, { status: 400 });
  const existing = await db.customTool.findUnique({ where: { key } });
  if (existing) return NextResponse.json({ error: "key exists" }, { status: 409 });
  const tool = await db.customTool.create({ data: { key, name, description, operations: JSON.stringify(operations ?? []), permissions: JSON.stringify(permissions ?? {}) } });
  return NextResponse.json({ tool });
}
