import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const where: Record<string, unknown> = {};
  if (projectId) where.projectId = projectId;
  const models = await db.revenueModel.findMany({ where, orderBy: { createdAt: "desc" } });
  const events = await db.revenueEvent.findMany({ where, orderBy: { createdAt: "desc" }, take: 50 });
  return NextResponse.json({ models, events });
}
