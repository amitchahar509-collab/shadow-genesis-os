import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import { db } from "@/lib/db";
import { AGENT_NAMES, describeAgents } from "@/lib/genesis/agent-runtime/agents";
import { resolveExecutableAgent } from "@/lib/genesis/agent-runtime/agents/template-agent";
import type { AgentRunInput } from "@/lib/genesis/agent-runtime/base-agent";
export async function GET() {
  const agents = describeAgents();
  // installed specialists are executable too — surface them next to the builtins
  const installed = await db.plugin.findMany({ where: { kind: "AGENT", status: "INSTALLED", refKey: { notIn: AGENT_NAMES } }, select: { pluginId: true, refKey: true, name: true, trustScore: true, invocations: true } });
  const recent = await db.agentExecution.findMany({ orderBy: { startedAt: "desc" }, take: 20, select: { executionId: true, agent: true, goal: true, status: true, startedAt: true, completedAt: true, durationMs: true, toolCalls: true, artifactsCreated: true } });
  return NextResponse.json({ agents, specialists: installed, recent, total: AGENT_NAMES.length });
}
export async function POST(req: NextRequest) {
  const _a = await guardWrite(req, "ADMIN"); if (!_a.ok) return _a.res;
  const body = await req.json();
  const { agent, goal, taskId, context, timeoutMs, projectId } = body;
  if (!agent || !goal) return NextResponse.json({ error: "agent and goal required" }, { status: 400 });
  const resolved = await resolveExecutableAgent(String(agent));
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const input: AgentRunInput = { goal, taskId, context, timeoutMs, projectId };
  try { const result = await resolved.agent.execute(input); return NextResponse.json({ result, kind: resolved.kind }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
