/** Agent Evolution Engine (V8 G7) — agents improve from real performance.
 *
 * Completes the existing improvement machinery (metrics + prompt-versioning +
 * failure analysis + arena learnings) with the engine that reads an agent's
 * REAL measured performance and decides + applies exactly one evolution action:
 *
 *   NO_ACTION         — insufficient data (<MIN_SAMPLES) or already healthy.
 *   RETIRE_WORKFLOW   — catastrophic success rate → roll the active prompt back
 *                       to the last known version (retire the bad workflow).
 *   CREATE_SPECIALIST — a strongly recurring failure category → propose a
 *                       specialist AgentTemplate scoped to that failure.
 *   IMPROVE_PROMPT    — middling + a recurring failure → append a corrective
 *                       directive to the active prompt (a new version).
 *
 * Honesty: every action is driven by real AgentExecution metrics + real
 * FailureAnalysis rows; with no data it does NOTHING (NO_ACTION with the
 * reason), and each action stores the metric snapshot + reason that triggered
 * it. A CREATE_SPECIALIST produces a template/spec, not a live registered agent
 * (registration needs code) — the reason says so.
 */

import { db } from "@/lib/db";
import { computeAgentMetrics } from "../observability/metrics";
import { getActivePrompt, setPrompt, rollback, listVersions } from "../improvement/prompts";
import { canUseTool } from "../tools";
import { emit } from "../event-bus";

const MIN_SAMPLES = 3;
const HEALTHY = 0.8;         // ≥ → healthy, no action
const RETIRE = 0.34;         // < → catastrophic, retire the workflow
const SPECIALIST_OCC = 4;    // recurring-failure occurrences that warrant a specialist

export type EvolutionKind = "IMPROVE_PROMPT" | "RETIRE_WORKFLOW" | "CREATE_SPECIALIST" | "NO_ACTION";

export interface AgentEvaluation {
  agent: string;
  metrics: { successRate: number; totalExecutions: number; errorCount: number; avgDurationMs: number } | null;
  recurring: { category: string; occurrences: number; recommendation: string }[];
}

export interface EvolutionResult {
  actionId: string; agent: string; kind: EvolutionKind; reason: string; applied: boolean; detail: string;
  metrics: AgentEvaluation["metrics"];
}

/** Read-only: an agent's real metrics + its recurring failure patterns. */
export async function evaluateAgent(agent: string, windowHours = 168): Promise<AgentEvaluation> {
  const m = await computeAgentMetrics(agent, windowHours);
  const failures = await db.failureAnalysis.findMany({ where: { agent: agent.toUpperCase(), OR: [{ recurring: true }, { occurrences: { gte: 2 } }] }, orderBy: { occurrences: "desc" }, take: 5 });
  return {
    agent: agent.toUpperCase(),
    metrics: m ? { successRate: m.successRate, totalExecutions: m.totalExecutions, errorCount: m.errorCount, avgDurationMs: m.avgDurationMs } : null,
    recurring: failures.map((f) => ({ category: f.category, occurrences: f.occurrences, recommendation: f.recommendation })),
  };
}

async function nextActionId(): Promise<string> {
  const rows = await db.evolutionAction.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { actionId: true } });
  let max = 0;
  for (const r of rows) { const m = r.actionId.match(/^EVO-(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `EVO-${(max + 1).toString().padStart(6, "0")}`;
}

/** Decide + (optionally) apply one evolution action for an agent, from real data. */
export async function evolveAgent(agent: string, opts?: { windowHours?: number; apply?: boolean }): Promise<EvolutionResult> {
  const apply = opts?.apply !== false;
  const evalResult = await evaluateAgent(agent, opts?.windowHours ?? 168);
  const A = agent.toUpperCase();
  const m = evalResult.metrics;
  const top = evalResult.recurring[0];

  let kind: EvolutionKind = "NO_ACTION";
  let reason = "";
  let detail = "";

  if (!m || m.totalExecutions < MIN_SAMPLES) {
    kind = "NO_ACTION";
    reason = `insufficient data: ${m?.totalExecutions ?? 0} execution(s) in window (need ${MIN_SAMPLES}).`;
  } else if (m.successRate >= HEALTHY) {
    kind = "NO_ACTION";
    reason = `healthy: successRate ${(m.successRate * 100).toFixed(0)}% over ${m.totalExecutions} runs — no change.`;
  } else if (m.successRate < RETIRE) {
    kind = "RETIRE_WORKFLOW";
    reason = `catastrophic: successRate ${(m.successRate * 100).toFixed(0)}% over ${m.totalExecutions} runs — retire current workflow.`;
    if (apply) {
      const rolled = await rollback(A);
      detail = rolled ? `rolled active prompt back to v${rolled.version}` : "no prior prompt version to roll back to — flagged for human retirement";
    } else detail = "dry-run: would roll back the active prompt";
  } else if (top && top.occurrences >= SPECIALIST_OCC) {
    kind = "CREATE_SPECIALIST";
    const key = `${A}_${top.category}_SPECIALIST`;
    reason = `persistent failure: "${top.category}" recurred ${top.occurrences}× — propose a specialist (template, not a live agent).`;
    if (apply) {
      const baseTools = ["filesystem", "memory", "terminal", "code"].filter((t) => canUseTool(A, t));
      await db.agentTemplate.upsert({
        where: { key },
        create: { key, name: `${A} ${top.category} specialist`, description: `Specialist proposed by evolution to handle recurring ${top.category} failures in ${A}. ${top.recommendation}`, systemPrompt: `You are a ${A} specialist for ${top.category} problems. Focus exclusively on: ${top.recommendation}. Verify each step; fail loudly rather than silently.`, toolAllowlist: JSON.stringify(baseTools.length ? baseTools : ["filesystem", "memory"]), isBuiltin: false },
        update: { description: `Updated by evolution: ${top.category} recurred ${top.occurrences}×. ${top.recommendation}` },
      });
      detail = `template ${key}`;
    } else detail = `dry-run: would propose template ${A}_${top.category}_SPECIALIST`;
  } else if (top) {
    kind = "IMPROVE_PROMPT";
    reason = `underperforming: successRate ${(m.successRate * 100).toFixed(0)}% with recurring "${top.category}" (${top.occurrences}×) — strengthen prompt.`;
    if (apply) {
      const base = await getActivePrompt(A);
      const baseText = base?.systemPrompt ?? `You are the ${A} agent.`;
      const guard = `\n\n[EVOLUTION guard v${Date.now().toString(36)}] Recurring failure "${top.category}": ${top.recommendation}. Explicitly check for this before completing.`;
      const v = await setPrompt(A, baseText + guard, `evolution: guard against ${top.category}`);
      detail = `prompt v${v.version}: added guard for ${top.category}`;
    } else detail = `dry-run: would add a prompt guard for ${top.category}`;
  } else {
    kind = "NO_ACTION";
    reason = `middling: successRate ${(m.successRate * 100).toFixed(0)}% but no recurring failure pattern to act on.`;
  }

  const actionId = await nextActionId();
  await db.evolutionAction.create({ data: { actionId, agent: A, kind, reason, metrics: JSON.stringify(m ?? {}), applied: apply && kind !== "NO_ACTION", detail } });
  await emit({ agent: "EVOLUTION", action: kind, detail: `${actionId} ${A}: ${reason.slice(0, 120)}`, level: kind === "RETIRE_WORKFLOW" ? "WARNING" : "INFO", category: "SYSTEM" });
  return { actionId, agent: A, kind, reason, applied: apply && kind !== "NO_ACTION", detail, metrics: m };
}

/** Evaluate + evolve every agent with recent activity. Defaults to a DRY RUN — pass apply:true to enact. */
export async function evolveAll(opts?: { windowHours?: number; apply?: boolean }): Promise<EvolutionResult[]> {
  const windowHours = opts?.windowHours ?? 168;
  const agents = await db.agentExecution.findMany({ where: { startedAt: { gte: new Date(Date.now() - windowHours * 3_600_000) } }, distinct: ["agent"], select: { agent: true } });
  const out: EvolutionResult[] = [];
  for (const { agent } of agents) out.push(await evolveAgent(agent, { windowHours, apply: opts?.apply ?? false }));
  await emit({ agent: "EVOLUTION", action: "SWEEP", detail: `evaluated ${out.length} agent(s); ${out.filter((r) => r.applied).length} action(s) applied`, level: "INFO", category: "SYSTEM" });
  return out;
}
