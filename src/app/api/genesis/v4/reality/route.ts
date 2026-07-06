import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const where: Record<string, unknown> = {};
  if (projectId) where.projectId = projectId;
  const signals = await db.realitySignal.findMany({ where, orderBy: { createdAt: "desc" }, take: 50 });
  return NextResponse.json({ signals });
}
export async function POST(req: NextRequest) {
  const { projectId, type, source, payload, sentiment, impact } = await req.json();
  if (!type || !source) return NextResponse.json({ error: "type and source required" }, { status: 400 });
  const signal = await db.realitySignal.create({ data: { projectId: projectId ?? null, type, source, payload: JSON.stringify(payload ?? {}), sentiment: sentiment ?? 0, impact: impact ?? "UNKNOWN" } });
  return NextResponse.json({ signal });
}
