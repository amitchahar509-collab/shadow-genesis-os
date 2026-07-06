import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; const t = await db.agentTemplate.findUnique({ where: { id } }); if (!t) return NextResponse.json({ error: "not found" }, { status: 404 }); return NextResponse.json({ template: t }); }
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await db.agentTemplate.findUnique({ where: { id } });
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (t.isBuiltin) return NextResponse.json({ error: "cannot delete built-in" }, { status: 400 });
  await db.agentTemplate.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
