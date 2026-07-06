import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const agent = searchParams.get("agent");
  const status = searchParams.get("status");
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
  const where: Record<string, unknown> = {};
  if (agent) where.agent = agent;
  if (status) where.status = status;
  const executions = await db.agentExecution.findMany({ where, orderBy: { startedAt: "desc" }, take: limit });
  return NextResponse.json({ executions, count: executions.length });
}
