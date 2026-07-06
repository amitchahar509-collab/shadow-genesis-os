// API route generators — run this to write all V4 API routes
import { promises as fs } from "node:fs";
import * as path from "node:path";

const routes: { path: string; content: string }[] = [
  // ============ AGENTS ============
  { path: "src/app/api/genesis/agents/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
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
  if (!instance) return NextResponse.json({ error: \`unknown agent: \${agent}\` }, { status: 404 });
  const input: AgentRunInput = { goal, taskId, context, timeoutMs, projectId };
  try { const result = await instance.execute(input); return NextResponse.json({ result }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
` },
  { path: "src/app/api/genesis/agents/states/route.ts", content: `import { NextResponse } from "next/server";
import { getStateManager } from "@/lib/genesis/agent-runtime/collab";
export async function GET() { const agents = await getStateManager().snapshot(); return NextResponse.json({ agents }); }
export async function PATCH(req: Request) {
  const { agent, action } = await req.json() as { agent: string; action: "pause" | "resume" };
  if (action === "pause") await getStateManager().pause(agent);
  else if (action === "resume") await getStateManager().resume(agent);
  else return NextResponse.json({ error: "action must be pause or resume" }, { status: 400 });
  return NextResponse.json({ agents: await getStateManager().snapshot() });
}
` },
  { path: "src/app/api/genesis/agents/graph/route.ts", content: `import { NextResponse } from "next/server";
import { getCollaborationGraph, ALL_AGENTS } from "@/lib/genesis/agent-runtime/collab";
export async function GET() {
  const g = getCollaborationGraph();
  const nodes = ALL_AGENTS.map((a) => ({ id: a, label: a, outgoing: g.getOutgoing(a) }));
  return NextResponse.json({ nodes, agents: ALL_AGENTS });
}
` },
  // ============ EXECUTIONS ============
  { path: "src/app/api/genesis/executions/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
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
` },
  { path: "src/app/api/genesis/executions/[id]/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
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
` },
  // ============ TOOLS ============
  { path: "src/app/api/genesis/tools/route.ts", content: `import { NextResponse } from "next/server";
import { listTools } from "@/lib/genesis/agent-runtime/tools";
export async function GET() {
  const tools = listTools().map((t) => ({ name: t.name, description: t.description, operations: t.operations }));
  return NextResponse.json({ tools, count: tools.length });
}
` },
  { path: "src/app/api/genesis/tools/[name]/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import * as path from "node:path";
import { promises as fs } from "node:fs";
import { getTool } from "@/lib/genesis/agent-runtime/tools";
import type { ToolContext } from "@/lib/genesis/agent-runtime/tools";
export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const body = await req.json();
  const { operation, input, sandbox } = body;
  const tool = getTool(name);
  if (!tool) return NextResponse.json({ error: \`unknown tool: \${name}\` }, { status: 404 });
  const sandboxRoot = path.resolve(process.cwd(), ".genesis-workspace", "manual", sandbox ?? \`manual-\${Date.now()}\`);
  await fs.mkdir(sandboxRoot, { recursive: true });
  const ctx: ToolContext = { executionId: \`MANUAL-\${Date.now()}\`, agent: "MANUAL", sandboxRoot, timeoutMs: 30_000 };
  const start = Date.now();
  const output = await tool.execute(operation, input, ctx);
  return NextResponse.json({ tool: name, operation, output, durationMs: Date.now() - start, sandboxRoot });
}
` },
  // ============ ARTIFACTS / TESTS / DEPLOYMENTS ============
  { path: "src/app/api/genesis/artifacts/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
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
` },
  { path: "src/app/api/genesis/tests/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
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
` },
  { path: "src/app/api/genesis/deployments/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const target = searchParams.get("target");
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (target) where.target = target;
  const records = await db.deploymentRecord.findMany({ where, orderBy: { createdAt: "desc" }, take: limit });
  return NextResponse.json({ records, count: records.length });
}
` },
  { path: "src/app/api/genesis/deployments/[id]/monitor/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { startMonitoring, stopMonitoring, getMonitorStatus } from "@/lib/genesis/agent-runtime/deployment/health-monitor";
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const status = getMonitorStatus(id);
  if (!status) return NextResponse.json({ running: false });
  return NextResponse.json(status);
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  if (body.action === "start") {
    if (!body.url) return NextResponse.json({ error: "url required" }, { status: 400 });
    const handle = startMonitoring(id, body.url, { intervalMs: body.intervalMs, failureThreshold: body.failureThreshold, maxDurationMs: body.maxDurationMs, rollbackAfterMs: body.rollbackAfterMs });
    return NextResponse.json({ monitor: { recordId: handle.recordId, url: handle.url, startedAt: handle.startedAt } });
  }
  if (body.action === "stop") { stopMonitoring(id); return NextResponse.json({ ok: true }); }
  return NextResponse.json({ error: \`unknown action: \${body.action}\` }, { status: 400 });
}
` },
  // ============ SANDBOXES ============
  { path: "src/app/api/genesis/sandboxes/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { createSandbox, listSandboxes, runInSandbox, cleanupExpired } from "@/lib/genesis/agent-runtime/sandbox/manager";
export async function GET() { const sandboxes = await listSandboxes(); return NextResponse.json({ sandboxes, count: sandboxes.length }); }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const action = body.action ?? "create";
  if (action === "create") { const sb = await createSandbox({ ttlSeconds: body.ttlSeconds, executionId: body.executionId, projectId: body.projectId, port: body.port, label: body.label }); return NextResponse.json({ sandbox: sb }); }
  if (action === "run") { if (!body.sandboxId || !body.command) return NextResponse.json({ error: "sandboxId and command required" }, { status: 400 }); try { const result = await runInSandbox(body.sandboxId, body.command, { timeoutMs: body.timeoutMs, env: body.env, detach: body.detach }); return NextResponse.json({ result }); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); } }
  if (action === "cleanup-expired") { const reaped = await cleanupExpired(); return NextResponse.json({ reaped }); }
  return NextResponse.json({ error: \`unknown action: \${action}\` }, { status: 400 });
}
` },
  { path: "src/app/api/genesis/sandboxes/[id]/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { getSandbox, cleanupSandbox, healthCheck, updateSandboxHealth } from "@/lib/genesis/agent-runtime/sandbox/manager";
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; const sb = await getSandbox(id); if (!sb) return NextResponse.json({ error: "not found" }, { status: 404 }); return NextResponse.json({ sandbox: sb }); }
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; await cleanupSandbox(id); return NextResponse.json({ ok: true }); }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  if (body.action === "health") { const r = await healthCheck(body.url, { timeoutMs: body.timeoutMs, intervalMs: body.intervalMs }); await updateSandboxHealth(id, r.ok ? "HEALTHY" : "UNHEALTHY"); return NextResponse.json(r); }
  return NextResponse.json({ error: \`unknown action: \${body.action}\` }, { status: 400 });
}
` },
  { path: "src/app/api/genesis/sandboxes/[id]/logs/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { tailLogs } from "@/lib/genesis/agent-runtime/sandbox/manager";
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(new URL(req.url).searchParams.get("n") ?? 100);
  const logs = await tailLogs(id, n);
  return NextResponse.json(logs);
}
` },
  // ============ METRICS ============
  { path: "src/app/api/genesis/metrics/summary/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { getMetricsSummary } from "@/lib/genesis/agent-runtime/observability/metrics";
export async function GET(req: NextRequest) {
  const windowHours = Number(new URL(req.url).searchParams.get("windowHours") ?? 24);
  const summary = await getMetricsSummary(windowHours);
  return NextResponse.json(summary);
}
` },
  { path: "src/app/api/genesis/metrics/cost/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { getCostSummary } from "@/lib/genesis/agent-runtime/observability/metrics";
export async function GET(req: NextRequest) {
  const days = Number(new URL(req.url).searchParams.get("days") ?? 7);
  const cost = await getCostSummary(days);
  return NextResponse.json(cost);
}
` },
  { path: "src/app/api/genesis/metrics/compute/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { computeAllAgentMetrics, computeAgentMetrics } from "@/lib/genesis/agent-runtime/observability/metrics";
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const windowHours = Number(body.windowHours ?? 24);
  if (body.agent) { const m = await computeAgentMetrics(body.agent, windowHours); return NextResponse.json({ metric: m }); }
  const metrics = await computeAllAgentMetrics(windowHours);
  return NextResponse.json({ metrics, count: metrics.length });
}
` },
  // ============ MEMORY ============
  { path: "src/app/api/genesis/memory/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMemoryEngine } from "@/lib/genesis/agent-runtime/memory/engine";
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const engine = searchParams.get("engine") ?? "recall";
  const type = searchParams.get("type") as "EPISODIC" | "SEMANTIC" | "PROCEDURAL" | null;
  const q = searchParams.get("q") ?? "";
  const tags = searchParams.get("tags")?.split(",").filter(Boolean) ?? [];
  const limit = Number(searchParams.get("limit") ?? 25);
  if (engine === "raw") {
    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (q) where.OR = [{ title: { contains: q } }, { content: { contains: q } }];
    const memory = await db.memoryEntry.findMany({ where, orderBy: [{ importance: "desc" }, { createdAt: "desc" }], take: limit });
    return NextResponse.json({ memory });
  }
  const results = await getMemoryEngine().recall({ query: q, type: type ?? undefined, tags, limit });
  return NextResponse.json({ memory: results, count: results.length, engine: "recall" });
}
export async function POST(req: NextRequest) {
  const body = await req.json();
  const created = await getMemoryEngine().record({ type: body.type, title: body.title, content: body.content, tags: body.tags ?? [], importance: body.importance ?? 5, source: body.source });
  return NextResponse.json({ memory: created });
}
` },
  { path: "src/app/api/genesis/memory/search/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { getMemoryEngine } from "@/lib/genesis/agent-runtime/memory/engine";
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const agent = searchParams.get("agent");
  const goal = searchParams.get("goal");
  const limit = Number(searchParams.get("limit") ?? 8);
  const tags = searchParams.get("tags")?.split(",").filter(Boolean) ?? [];
  const engine = getMemoryEngine();
  if (agent && goal) { const results = await engine.relevant({ agent, goal, limit }); return NextResponse.json({ results, count: results.length, mode: "relevant" }); }
  const results = await engine.recall({ query: q, tags, limit });
  return NextResponse.json({ results, count: results.length, mode: "recall" });
}
` },
  // ============ ORCHESTRATOR ============
  { path: "src/app/api/genesis/orchestrator/dispatch/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { dispatchGoal, startMission } from "@/lib/genesis/agent-runtime/orchestrator";
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { goal, skipCeo, taskIds, projectId, background } = body;
  if (!goal && !taskIds?.length) return NextResponse.json({ error: "goal (or taskIds[]) required" }, { status: 400 });
  if (background !== false) {
    const handle = startMission(goal ?? "(taskIds provided)", projectId);
    return NextResponse.json({ mission: handle, note: "running in background — poll /api/genesis/orchestrator/missions for status" });
  }
  try { const result = await dispatchGoal(goal ?? "(taskIds provided)", { skipCeo, taskIds, projectId }); return NextResponse.json({ result }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
` },
  { path: "src/app/api/genesis/orchestrator/missions/route.ts", content: `import { NextResponse } from "next/server";
import { listMissions } from "@/lib/genesis/agent-runtime/orchestrator";
export async function GET() { return NextResponse.json({ missions: listMissions() }); }
` },
  { path: "src/app/api/genesis/orchestrator/status/route.ts", content: `import { NextResponse } from "next/server";
import { getStatus } from "@/lib/genesis/agent-runtime/orchestrator";
export async function GET() { const status = await getStatus(); return NextResponse.json({ status }); }
` },
  // ============ PROJECTS ============
  { path: "src/app/api/genesis/projects/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET() { const projects = await db.project.findMany({ orderBy: { createdAt: "desc" } }); return NextResponse.json({ projects }); }
export async function POST(req: NextRequest) {
  const { name, mission, type, priority } = await req.json();
  if (!name || !mission) return NextResponse.json({ error: "name and mission required" }, { status: 400 });
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const project = await db.project.create({ data: { key, name, mission, type: type ?? "PRODUCT", priority: priority ?? "MEDIUM" } });
  return NextResponse.json({ project });
}
` },
  { path: "src/app/api/genesis/projects/[key]/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string }> }) { const { key } = await params; const project = await db.project.findUnique({ where: { key } }); if (!project) return NextResponse.json({ error: "not found" }, { status: 404 }); return NextResponse.json({ project }); }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const body = await req.json();
  const project = await db.project.update({ where: { key }, data: body });
  return NextResponse.json({ project });
}
` },
  // ============ DECISIONS ============
  { path: "src/app/api/genesis/decisions/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET() { const decisions = await db.agentDecision.findMany({ orderBy: { createdAt: "desc" }, take: 50 }); return NextResponse.json({ decisions }); }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const decisionId = \`DEC-\${Date.now().toString(36)}\`;
  const decision = await db.agentDecision.create({ data: { decisionId, agent: body.agent, targetAgent: body.targetAgent, taskId: body.taskId, executionId: body.executionId, type: body.type, rationale: body.rationale, payload: "{}", requiresHumanApproval: Boolean(body.requiresHumanApproval), humanStatus: body.requiresHumanApproval ? "PENDING" : null } });
  return NextResponse.json({ decision });
}
` },
  { path: "src/app/api/genesis/decisions/[id]/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { humanStatus } = await req.json() as { humanStatus: "APPROVED" | "REJECTED" };
  if (!["APPROVED", "REJECTED"].includes(humanStatus)) return NextResponse.json({ error: "humanStatus must be APPROVED or REJECTED" }, { status: 400 });
  const updated = await db.agentDecision.update({ where: { id }, data: { humanStatus, decidedAt: new Date() } });
  return NextResponse.json({ decision: updated });
}
` },
  // ============ MESSAGES ============
  { path: "src/app/api/genesis/messages/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { getMessageBus } from "@/lib/genesis/agent-runtime/collab";
export async function GET() { const messages = await getMessageBus().list(50); return NextResponse.json({ messages }); }
export async function POST(req: NextRequest) {
  const { fromAgent, toAgent, type, payload } = await req.json();
  try { const msg = await getMessageBus().send(fromAgent, toAgent, type, payload ?? {}); return NextResponse.json({ message: msg }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 403 }); }
}
` },
  // ============ SECURITY ============
  { path: "src/app/api/genesis/security/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const severity = searchParams.get("severity");
  const status = searchParams.get("status");
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
  const where: Record<string, unknown> = {};
  if (severity) where.severity = severity;
  if (status) where.status = status;
  const findings = await db.securityFinding.findMany({ where, orderBy: { createdAt: "desc" }, take: limit });
  const bySeverity = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const f of findings) bySeverity[f.severity as keyof typeof bySeverity]++;
  return NextResponse.json({ findings, count: findings.length, bySeverity });
}
` },
  { path: "src/app/api/genesis/security/[id]/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const statusMap: Record<string, string> = { acknowledge: "ACKNOWLEDGED", fix: "FIXED", "false-positive": "FALSE_POSITIVE" };
  const newStatus = statusMap[body.action];
  if (!newStatus) return NextResponse.json({ error: \`unknown action: \${body.action}\` }, { status: 400 });
  const updated = await db.securityFinding.update({ where: { id }, data: { status: newStatus, resolvedAt: new Date() } });
  return NextResponse.json({ finding: updated });
}
` },
  { path: "src/app/api/genesis/security/release-check/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
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
` },
  // ============ AGENT TEMPLATES ============
  { path: "src/app/api/genesis/agent-templates/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET() { const templates = await db.agentTemplate.findMany({ orderBy: [{ isBuiltin: "desc" }, { name: "asc" }] }); return NextResponse.json({ templates, count: templates.length }); }
export async function POST(req: NextRequest) {
  const { key, name, description, systemPrompt, toolAllowlist, defaultContext } = await req.json();
  if (!key || !name || !description || !systemPrompt) return NextResponse.json({ error: "key, name, description, systemPrompt required" }, { status: 400 });
  const existing = await db.agentTemplate.findUnique({ where: { key } });
  if (existing) return NextResponse.json({ error: "key already exists" }, { status: 409 });
  const template = await db.agentTemplate.create({ data: { key, name, description, systemPrompt, toolAllowlist: JSON.stringify(toolAllowlist ?? []), defaultContext: JSON.stringify(defaultContext ?? {}), isBuiltin: false } });
  return NextResponse.json({ template });
}
` },
  { path: "src/app/api/genesis/agent-templates/[id]/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; const t = await db.agentTemplate.findUnique({ where: { id } }); if (!t) return NextResponse.json({ error: "not found" }, { status: 404 }); return NextResponse.json({ template: t }); }
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await db.agentTemplate.findUnique({ where: { id } });
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (t.isBuiltin) return NextResponse.json({ error: "cannot delete built-in" }, { status: 400 });
  await db.agentTemplate.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
` },
  // ============ PROMPTS ============
  { path: "src/app/api/genesis/prompts/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { getActivePrompt, setPrompt, listVersions } from "@/lib/genesis/agent-runtime/improvement/prompts";
export async function GET(req: NextRequest) {
  const agent = new URL(req.url).searchParams.get("agent");
  if (!agent) return NextResponse.json({ error: "agent required" }, { status: 400 });
  const versions = await listVersions(agent);
  const active = await getActivePrompt(agent);
  return NextResponse.json({ versions, active });
}
export async function POST(req: NextRequest) {
  const { agent, systemPrompt, notes } = await req.json();
  if (!agent || !systemPrompt) return NextResponse.json({ error: "agent + systemPrompt required" }, { status: 400 });
  const p = await setPrompt(agent, systemPrompt, notes);
  return NextResponse.json({ prompt: p });
}
` },
  { path: "src/app/api/genesis/prompts/[id]/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { activateVersion, recordOutcome } from "@/lib/genesis/agent-runtime/improvement/prompts";
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  if (body.action === "activate") { const p = await activateVersion(id); if (!p) return NextResponse.json({ error: "not found" }, { status: 404 }); return NextResponse.json({ prompt: p }); }
  if (body.action === "record-outcome") { await recordOutcome(id, Boolean(body.success)); return NextResponse.json({ ok: true }); }
  return NextResponse.json({ error: \`unknown action: \${body.action}\` }, { status: 400 });
}
` },
  { path: "src/app/api/genesis/prompts/rollback/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { rollback } from "@/lib/genesis/agent-runtime/improvement/prompts";
export async function POST(req: NextRequest) {
  const { agent } = await req.json();
  if (!agent) return NextResponse.json({ error: "agent required" }, { status: 400 });
  const rolled = await rollback(agent);
  if (!rolled) return NextResponse.json({ error: "no previous version" }, { status: 404 });
  return NextResponse.json({ prompt: rolled });
}
` },
  // ============ V4 — OPPORTUNITIES ============
  { path: "src/app/api/genesis/opportunities/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
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
` },
  { path: "src/app/api/genesis/opportunities/[id]/validate/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { BusinessValidationAgent } from "@/lib/genesis/agent-runtime/agents/v4-validation";
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = new BusinessValidationAgent();
  const result = await agent.execute({ goal: id, context: { opportunityId: id } });
  return NextResponse.json({ result });
}
` },
  // ============ V4 — COMPANIES ============
  { path: "src/app/api/genesis/companies/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET() { const companies = await db.company.findMany({ orderBy: { createdAt: "desc" } }); return NextResponse.json({ companies }); }
export async function POST(req: NextRequest) {
  const { name, mission } = await req.json();
  if (!name || !mission) return NextResponse.json({ error: "name and mission required" }, { status: 400 });
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const company = await db.company.create({ data: { key, name, mission } });
  return NextResponse.json({ company });
}
` },
  // ============ V4 — REVENUE ============
  { path: "src/app/api/genesis/revenue/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
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
` },
  // ============ V4 — GROWTH ============
  { path: "src/app/api/genesis/growth/experiments/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const where: Record<string, unknown> = {};
  if (projectId) where.projectId = projectId;
  const experiments = await db.growthExperiment.findMany({ where, orderBy: { createdAt: "desc" } });
  const metrics = await db.growthMetric.findMany({ where, orderBy: { recordedAt: "desc" }, take: 50 });
  return NextResponse.json({ experiments, metrics });
}
export async function POST(req: NextRequest) {
  const { projectId, name, hypothesis, variant, metric } = await req.json();
  if (!name || !hypothesis) return NextResponse.json({ error: "name and hypothesis required" }, { status: 400 });
  const exp = await db.growthExperiment.create({ data: { projectId: projectId ?? null, name, hypothesis, variant: variant ?? "A", metric: metric ?? "conversion" } });
  return NextResponse.json({ experiment: exp });
}
` },
  // ============ V4 — DISPATCH (full autonomous pipeline) ============
  { path: "src/app/api/genesis/v4/dispatch/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { dispatchGoal, startMission } from "@/lib/genesis/agent-runtime/orchestrator";
/** POST /api/genesis/v4/dispatch — "Build my idea" entry point.
 * body: { goal, projectId?, background? }
 * Runs the full V4 pipeline: CEO → RESEARCH → OPPORTUNITY → BUSINESS_VALIDATION → ARCHITECT → ENGINEERING → QUALITY → SECURITY → DEPLOYMENT → GROWTH → REVENUE.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { goal, projectId, background } = body;
  if (!goal) return NextResponse.json({ error: "goal required" }, { status: 400 });
  if (background !== false) {
    const handle = startMission(goal, projectId);
    return NextResponse.json({ mission: handle, pipeline: "CEO → RESEARCH → OPPORTUNITY → VALIDATION → ARCHITECT → ENGINEERING → QUALITY → SECURITY → DEPLOYMENT → GROWTH → REVENUE" });
  }
  try { const result = await dispatchGoal(goal, { projectId }); return NextResponse.json({ result }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
` },
  // ============ V4 — SYSTEM MAP ============
  { path: "src/app/api/genesis/v4/system-map/route.ts", content: `import { NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET() {
  const [executions, tasks, opportunities, projects, agents, messages, findings, missions] = await Promise.all([
    db.agentExecution.count(),
    db.genesisTask.count(),
    db.opportunity.count(),
    db.project.count(),
    db.agentState.count(),
    db.agentMessage.count(),
    db.securityFinding.count(),
    db.deploymentRecord.count(),
  ]);
  return NextResponse.json({
    capabilities: ["agent-runtime", "multi-agent-graph", "task-orchestrator", "tool-system", "sandbox-runtime", "engineering-factory", "memory-brain", "deployment-monitor", "observability", "security-layer", "human-ceo-controls", "internet-operator", "opportunity-discovery", "business-validation", "revenue-intelligence", "growth-os", "multi-company", "agent-evolution", "knowledge-graph", "reality-feedback", "self-audit"],
    counts: { executions, tasks, opportunities, projects, agents, messages, findings, missions },
    agents: ["CEO", "RESEARCH", "ARCHITECT", "ENGINEERING", "DESIGN", "GROWTH", "QUALITY", "DEPLOYMENT", "SECURITY", "OPPORTUNITY", "BUSINESS_VALIDATION", "REVENUE", "INTERNET"],
  });
}
` },
  // ============ V4 — SELF AUDIT ============
  { path: "src/app/api/genesis/v4/self-audit/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
const AUDIT_QUESTIONS = [
  "Are we solving a real problem?",
  "Is this valuable to users?",
  "Is there evidence to support our assumptions?",
  "What are we missing?",
  "Are there blind spots in our strategy?",
  "Is the cost justified by the value?",
  "Are we measuring the right things?",
  "What would happen if we stopped?",
];
export async function GET() {
  const audits = await db.selfAudit.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
  return NextResponse.json({ audits, questions: AUDIT_QUESTIONS });
}
export async function POST(req: NextRequest) {
  const { question, context } = await req.json();
  const audit = await db.selfAudit.create({ data: { question, context: JSON.stringify(context ?? {}), finding: "", recommendation: "", severity: "INFO" } });
  return NextResponse.json({ audit });
}
` },
  // ============ V4 — REALITY FEEDBACK ============
  { path: "src/app/api/genesis/v4/reality/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const where: Record<string, unknown> = {};
  if (projectId) where.projectId = projectId;
  const signals = await db.realitySignal.findMany({ where, orderBy: { createdAt: "desc" }, take: 50 });
  return NextResponse.json({ signals });
}
export async function POST(req: NextRequest) {
  const { projectId, type, source, payload, sentiment, impact } = await req.json();
  if (!type || !source) return NextResponse.json({ error: "type and source required" }, { status: 400 });
  const signal = await db.realitySignal.create({ data: { projectId: projectId ?? null, type, source, payload: JSON.stringify(payload ?? {}), sentiment: sentiment ?? 0, impact: impact ?? "UNKNOWN" } });
  return NextResponse.json({ signal });
}
` },
  // ============ V4 — KNOWLEDGE GRAPH ============
  { path: "src/app/api/genesis/v4/knowledge/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET() {
  const [nodes, edges] = await Promise.all([
    db.knowledgeNode.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    db.knowledgeEdge.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  return NextResponse.json({ nodes, edges });
}
export async function POST(req: NextRequest) {
  const { type, label, description, properties } = await req.json();
  if (!type || !label) return NextResponse.json({ error: "type and label required" }, { status: 400 });
  const node = await db.knowledgeNode.create({ data: { type, label, description: description ?? "", properties: JSON.stringify(properties ?? {}) } });
  return NextResponse.json({ node });
}
` },
  // ============ V4 — CUSTOM TOOLS ============
  { path: "src/app/api/genesis/custom-tools/route.ts", content: `import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET() { const tools = await db.customTool.findMany({ orderBy: [{ isBuiltin: "desc" }, { name: "asc" }] }); return NextResponse.json({ tools }); }
export async function POST(req: NextRequest) {
  const { key, name, description, operations, permissions } = await req.json();
  if (!key || !name || !description) return NextResponse.json({ error: "key, name, description required" }, { status: 400 });
  const existing = await db.customTool.findUnique({ where: { key } });
  if (existing) return NextResponse.json({ error: "key exists" }, { status: 409 });
  const tool = await db.customTool.create({ data: { key, name, description, operations: JSON.stringify(operations ?? []), permissions: JSON.stringify(permissions ?? {}) } });
  return NextResponse.json({ tool });
}
` },
];

async function main() {
  for (const r of routes) {
    await fs.mkdir(path.dirname(r.path), { recursive: true });
    await fs.writeFile(r.path, r.content, "utf8");
    console.log("✓", r.path);
  }
  console.log(`\nWrote ${routes.length} routes`);
}
main().catch(console.error);
