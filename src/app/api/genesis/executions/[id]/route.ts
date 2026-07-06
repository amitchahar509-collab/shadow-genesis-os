import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const execution = await db.agentExecution.findUnique({ where: { executionId: id } });
  if (!execution) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [toolCalls, artifacts, testRuns] = await Promise.all([
    db.toolCall.findMany({ where: { executionId: id }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.artifact.findMany({ where: { executionId: id }, orderBy: { createdAt: "desc" } }),
    db.testRun.findMany({ where: { executionId: id }, orderBy: { createdAt: "desc" } }),
  ]);
  return NextResponse.json({ execution, toolCalls, artifacts, testRuns });
}
