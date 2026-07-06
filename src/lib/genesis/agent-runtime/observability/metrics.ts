/** Observability Center (V3 Phase 8) — agent performance + cost tracking. */

import { db } from "@/lib/db";
import { emit, events } from "../event-bus";

export async function computeAgentMetrics(agent: string, windowHours = 24) {
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - windowHours * 3_600_000);
  const executions = await db.agentExecution.findMany({ where: { agent, startedAt: { gte: windowStart } }, orderBy: { startedAt: "asc" } });
  if (executions.length === 0) return null;
  const successCount = executions.filter((e) => e.status === "SUCCESS").length;
  const durations = executions.map((e) => e.durationMs).sort((a, b) => a - b);
  const p95 = durations.length > 0 ? durations[Math.floor(durations.length * 0.95)] : 0;
  const toolCallCount = executions.reduce((s, e) => s + e.toolCalls, 0);
  const artifactCount = executions.reduce((s, e) => s + e.artifactsCreated, 0);
  const errorCount = executions.filter((e) => e.status === "FAILED").length;
  const avgDurationMs = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  const metric = { agent, windowStart, windowEnd, successRate: executions.length > 0 ? successCount / executions.length : 0, avgDurationMs, p95DurationMs: p95, toolCallCount, artifactCount, errorCount, totalExecutions: executions.length };
  try { await db.agentMetric.create({ data: { agent, windowStart, windowEnd, successRate: metric.successRate, avgDurationMs, p95DurationMs: p95, toolCallCount, artifactCount, errorCount } }); } catch {}
  return metric;
}

export async function computeAllAgentMetrics(windowHours = 24) {
  const agents = await db.agentExecution.findMany({ where: { startedAt: { gte: new Date(Date.now() - windowHours * 3_600_000) } }, distinct: ["agent"], select: { agent: true } });
  const results: NonNullable<Awaited<ReturnType<typeof computeAgentMetrics>>>[] = [];
  for (const { agent } of agents) { const m = await computeAgentMetrics(agent, windowHours); if (m) results.push(m); }
  await emit(events.tool("METRICS", null, `computed metrics for ${results.length} agents`));
  return results;
}

export async function getMetricsSummary(windowHours = 24) {
  const windowStart = new Date(Date.now() - windowHours * 3_600_000);
  const [executions, toolCalls, artifacts, recentErrors, testRuns] = await Promise.all([
    db.agentExecution.findMany({ where: { startedAt: { gte: windowStart } } }),
    db.toolCall.count({ where: { createdAt: { gte: windowStart } } }),
    db.artifact.count({ where: { createdAt: { gte: windowStart } } }),
    db.agentExecution.findMany({ where: { status: "FAILED", startedAt: { gte: windowStart } }, orderBy: { startedAt: "desc" }, take: 10, select: { executionId: true, agent: true, error: true, durationMs: true, startedAt: true } }),
    db.testRun.findMany({ where: { createdAt: { gte: windowStart } } }),
  ]);
  const byAgent = new Map<string, { success: number; failed: number; total: number; durations: number[]; toolCalls: number; artifacts: number; }>();
  for (const e of executions) {
    let a = byAgent.get(e.agent); if (!a) { a = { success: 0, failed: 0, total: 0, durations: [], toolCalls: 0, artifacts: 0 }; byAgent.set(e.agent, a); }
    a.total++; if (e.status === "SUCCESS") a.success++; else if (e.status === "FAILED") a.failed++;
    a.durations.push(e.durationMs); a.toolCalls += e.toolCalls; a.artifacts += e.artifactsCreated;
  }
  const agents = Array.from(byAgent.entries()).map(([agent, a]) => { a.durations.sort((x, y) => x - y); const p95 = a.durations.length > 0 ? a.durations[Math.floor(a.durations.length * 0.95)] : 0; return { agent, successRate: a.total > 0 ? a.success / a.total : 0, avgDurationMs: a.durations.length > 0 ? Math.round(a.durations.reduce((x, y) => x + y, 0) / a.durations.length) : 0, p95DurationMs: p95, totalExecutions: a.total, toolCallCount: a.toolCalls, artifactCount: a.artifacts, errorCount: a.failed }; }).sort((a, b) => b.totalExecutions - a.totalExecutions);
  const allDurations = executions.map((e) => e.durationMs);
  const allSuccess = executions.filter((e) => e.status === "SUCCESS").length;
  const testPassed = testRuns.reduce((s, r) => s + r.passed, 0);
  const testFailed = testRuns.reduce((s, r) => s + r.failed, 0);
  return {
    agents,
    totals: { executions: executions.length, toolCalls, artifacts, avgDurationMs: allDurations.length > 0 ? Math.round(allDurations.reduce((a, b) => a + b, 0) / allDurations.length) : 0, successRate: executions.length > 0 ? allSuccess / executions.length : 0 },
    recentErrors: recentErrors.map((e) => ({ executionId: e.executionId, agent: e.agent, error: e.error ?? "unknown", durationMs: e.durationMs, createdAt: e.startedAt })),
    testPassRate: testPassed + testFailed > 0 ? testPassed / (testPassed + testFailed) : 0,
  };
}

export async function getCostSummary(days = 7) {
  const windowStart = new Date(Date.now() - days * 24 * 3_600_000);
  const executions = await db.agentExecution.findMany({ where: { startedAt: { gte: windowStart } }, orderBy: { startedAt: "asc" } });
  const byAgentMap = new Map<string, { tokens: number; cost: number; executions: number }>();
  const byDayMap = new Map<string, { tokens: number; cost: number }>();
  let totalTokens = 0, totalCost = 0;
  for (const e of executions) {
    const tokens = e.tokensUsed ?? 0;
    const cost = (tokens * 0.6 * 1.0 + tokens * 0.4 * 3.0) / 1_000_000;
    totalTokens += tokens; totalCost += cost;
    let a = byAgentMap.get(e.agent); if (!a) { a = { tokens: 0, cost: 0, executions: 0 }; byAgentMap.set(e.agent, a); }
    a.tokens += tokens; a.cost += cost; a.executions++;
    const day = e.startedAt.toISOString().slice(0, 10);
    let d = byDayMap.get(day); if (!d) { d = { tokens: 0, cost: 0 }; byDayMap.set(day, d); }
    d.tokens += tokens; d.cost += cost;
  }
  return { totalTokens, totalCost, byAgent: Array.from(byAgentMap.entries()).map(([agent, v]) => ({ agent, ...v })).sort((a, b) => b.tokens - a.tokens), byDay: Array.from(byDayMap.entries()).map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day)) };
}
