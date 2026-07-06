import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const executionId = searchParams.get("executionId");
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
  const where: Record<string, unknown> = {};
  if (type) where.type = type;
  if (executionId) where.executionId = executionId;
  const artifacts = await db.artifact.findMany({ where, orderBy: { createdAt: "desc" }, take: limit });
  return NextResponse.json({ artifacts, count: artifacts.length });
}
