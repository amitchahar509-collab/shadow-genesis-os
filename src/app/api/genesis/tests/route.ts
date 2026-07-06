import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const executionId = searchParams.get("executionId");
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (executionId) where.executionId = executionId;
  const runs = await db.testRun.findMany({ where, orderBy: { createdAt: "desc" }, take: limit });
  const totals = runs.reduce((acc, r) => { acc.passed += r.passed; acc.failed += r.failed; acc.skipped += r.skipped; return acc; }, { passed: 0, failed: 0, skipped: 0 });
  return NextResponse.json({ runs, count: runs.length, totals });
}
