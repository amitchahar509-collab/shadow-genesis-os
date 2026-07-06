import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AGENT_NAMES, describeAgents, getAgent } from "@/lib/genesis/agent-runtime/agents";
import type { AgentRunInput } from "@/lib/genesis/agent-runtime/base-agent";
export async function GET() {
  const agents = describeAgents();
  const recent = await db.agentExecution.findMany({ orderBy: { startedAt: "desc" }, take: 20, select: { executionId: true, agent: true, goal: true, status: true, startedAt: true, completedAt: true, durationMs: true, toolCalls: true, artifactsCreated: true } });
  return NextResponse.json({ agents, recent, total: AGENT_NAMES.length });
}
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { agent, goal, taskId, context, timeoutMs, projectId } = body;
  if (!agent || !goal) return NextResponse.json({ error: "agent and goal required" }, { status: 400 });
  const instance = getAgent(agent);
  if (!instance) return NextResponse.json({ error: `unknown agent: ${agent}` }, { status: 404 });
  const input: AgentRunInput = { goal, taskId, context, timeoutMs, projectId };
  try { const result = await instance.execute(input); return NextResponse.json({ result }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
