import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const where: Record<string, unknown> = {};
  if (projectId) where.projectId = projectId;
  const experiments = await db.growthExperiment.findMany({ where, orderBy: { createdAt: "desc" } });
  const metrics = await db.growthMetric.findMany({ where, orderBy: { recordedAt: "desc" }, take: 50 });
  return NextResponse.json({ experiments, metrics });
}
export async function POST(req: NextRequest) {
  const { projectId, name, hypothesis, variant, metric } = await req.json();
  if (!name || !hypothesis) return NextResponse.json({ error: "name and hypothesis required" }, { status: 400 });
  const exp = await db.growthExperiment.create({ data: { projectId: projectId ?? null, name, hypothesis, variant: variant ?? "A", metric: metric ?? "conversion" } });
  return NextResponse.json({ experiment: exp });
}
