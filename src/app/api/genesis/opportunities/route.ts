import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  const opportunities = await db.opportunity.findMany({ where, orderBy: { createdAt: "desc" }, take: limit });
  return NextResponse.json({ opportunities, count: opportunities.length });
}
