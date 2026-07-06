import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const executionId = searchParams.get("executionId");
  const projectId = searchParams.get("projectId");
  const where: Record<string, unknown> = { status: "OPEN", blocksRelease: true };
  if (executionId) where.scopeId = executionId;
  if (projectId) where.scopeId = projectId;
  const blockers = await db.securityFinding.findMany({ where, orderBy: { severity: "asc" } });
  const allOpenWhere: Record<string, unknown> = { status: "OPEN" };
  if (executionId) allOpenWhere.scopeId = executionId;
  if (projectId) allOpenWhere.scopeId = projectId;
  const totalOpen = await db.securityFinding.count({ where: allOpenWhere });
  return NextResponse.json({ blocked: blockers.length > 0, blockers, totalOpen, checkedAt: new Date().toISOString() });
}
