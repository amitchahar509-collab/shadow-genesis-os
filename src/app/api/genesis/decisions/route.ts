import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET() { const decisions = await db.agentDecision.findMany({ orderBy: { createdAt: "desc" }, take: 50 }); return NextResponse.json({ decisions }); }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const decisionId = `DEC-${Date.now().toString(36)}`;
  const decision = await db.agentDecision.create({ data: { decisionId, agent: body.agent, targetAgent: body.targetAgent, taskId: body.taskId, executionId: body.executionId, type: body.type, rationale: body.rationale, payload: "{}", requiresHumanApproval: Boolean(body.requiresHumanApproval), humanStatus: body.requiresHumanApproval ? "PENDING" : null } });
  return NextResponse.json({ decision });
}
