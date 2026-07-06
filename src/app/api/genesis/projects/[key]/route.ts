import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string }> }) { const { key } = await params; const project = await db.project.findUnique({ where: { key } }); if (!project) return NextResponse.json({ error: "not found" }, { status: 404 }); return NextResponse.json({ project }); }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const body = await req.json();
  const project = await db.project.update({ where: { key }, data: body });
  return NextResponse.json({ project });
}
