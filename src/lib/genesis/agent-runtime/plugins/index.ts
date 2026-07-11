/** Plugin / Skill Marketplace (V8 G11) — installable ecosystem over REAL artifacts.
 *
 * Extends the existing AgentTemplate + CustomTool systems (not a rebuild) into a
 * marketplace of installable AGENT / TOOL / WORKFLOW plugins with:
 *   - performance from REAL data — AgentExecution (agents) / ToolCall (tools);
 *   - trust scores = source baseline + performance × volume-confidence + benchmark
 *     (an unproven plugin with no usage is low-trust until it earns it);
 *   - usage metrics, install counts, versioning, and on-demand benchmarking.
 *
 * Honesty: a plugin can ONLY wrap an artifact that really exists (a registered
 * agent/tool, an AgentTemplate/CustomTool row, or a known workflow) — publishing
 * a plugin for a non-existent module is refused. Usage/performance are read from
 * real execution rows; nothing is fabricated. A freshly published plugin is
 * "unproven" (trust from source alone) until real runs accumulate.
 */

import { db } from "@/lib/db";
import { AGENT_NAMES } from "../agents";
import { listTools } from "../tools";
import { computeAgentMetrics } from "../observability/metrics";
import { emit } from "../event-bus";

export type PluginKind = "AGENT" | "TOOL" | "WORKFLOW" | "SKILL";
export type PluginSource = "BUILTIN" | "EVOLUTION" | "USER";

export const KNOWN_WORKFLOWS = ["createCompany", "arena", "acquisition", "operator", "world-scan", "demand"];
const SOURCE_BASELINE: Record<PluginSource, number> = { BUILTIN: 65, EVOLUTION: 50, USER: 40 };
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

/** Does the artifact a plugin would wrap actually exist? (no fake modules) */
export async function artifactExists(kind: PluginKind, refKey: string): Promise<boolean> {
  if (kind === "AGENT") return AGENT_NAMES.includes(refKey.toUpperCase()) || !!(await db.agentTemplate.findUnique({ where: { key: refKey } }));
  if (kind === "TOOL") return listTools().some((t) => t.name === refKey) || !!(await db.customTool.findUnique({ where: { key: refKey } }));
  // SKILL = an agent's versioned system prompt (PromptVersion rows carry real outcome counts)
  if (kind === "SKILL") return (await db.promptVersion.count({ where: { agent: refKey.toUpperCase() } })) > 0;
  return KNOWN_WORKFLOWS.includes(refKey);
}

async function nextPluginId(): Promise<string> {
  const rows = await db.plugin.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { pluginId: true } });
  let max = 0; for (const r of rows) { const m = r.pluginId.match(/^PLG-(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `PLG-${(max + 1).toString().padStart(6, "0")}`;
}

export interface PublishInput { kind: PluginKind; refKey: string; name?: string; description?: string; source?: PluginSource; config?: Record<string, unknown> }

/** Publish a plugin wrapping a real artifact. Refuses non-existent artifacts and duplicates. */
export async function publishPlugin(input: PublishInput): Promise<{ pluginId: string } | { error: string }> {
  if (!(await artifactExists(input.kind, input.refKey))) return { error: `no such ${input.kind.toLowerCase()} artifact: "${input.refKey}"` };
  const existing = await db.plugin.findUnique({ where: { kind_refKey: { kind: input.kind, refKey: input.refKey } } });
  if (existing) return { pluginId: existing.pluginId };
  const pluginId = await nextPluginId();
  await db.plugin.create({
    data: {
      pluginId, kind: input.kind, refKey: input.refKey, name: input.name ?? input.refKey,
      description: input.description ?? `${input.kind} plugin wrapping ${input.refKey}`, source: input.source ?? "BUILTIN", status: "LISTED",
      versions: { create: { version: 1, changelog: "initial publish", config: JSON.stringify(input.config ?? {}), active: true } },
    },
  });
  await refreshStats(pluginId);
  await emit({ agent: "MARKETPLACE", action: "PLUGIN_PUBLISH", detail: `${pluginId} ${input.kind} "${input.refKey}" (${input.source ?? "BUILTIN"})`, level: "INFO", category: "SYSTEM" });
  return { pluginId };
}

/** Populate the ecosystem from REAL artifacts: registered agents, base tools, evolution templates, custom tools. */
export async function syncFromRegistry(): Promise<{ published: number }> {
  let published = 0;
  for (const agent of AGENT_NAMES) { const r = await publishPlugin({ kind: "AGENT", refKey: agent, source: "BUILTIN", description: `Built-in ${agent} agent` }); if ("pluginId" in r) published++; }
  for (const tool of listTools()) { const r = await publishPlugin({ kind: "TOOL", refKey: tool.name, source: "BUILTIN", description: tool.description.slice(0, 200) }); if ("pluginId" in r) published++; }
  for (const t of await db.agentTemplate.findMany({ where: { isBuiltin: false } })) { const r = await publishPlugin({ kind: "AGENT", refKey: t.key, name: t.name, source: "EVOLUTION", description: t.description.slice(0, 200) }); if ("pluginId" in r) published++; }
  for (const t of await db.customTool.findMany({ where: { isBuiltin: false } })) { const r = await publishPlugin({ kind: "TOOL", refKey: t.key, name: t.name, source: "USER", description: t.description.slice(0, 200) }); if ("pluginId" in r) published++; }
  for (const wf of KNOWN_WORKFLOWS) { const r = await publishPlugin({ kind: "WORKFLOW", refKey: wf, source: "BUILTIN", description: `Built-in ${wf} workflow` }); if ("pluginId" in r) published++; }
  // SKILL plugins: one per agent that has real versioned prompts (the skill IS the prompt lineage)
  const skillAgents = await db.promptVersion.groupBy({ by: ["agent"] });
  for (const s of skillAgents) { const r = await publishPlugin({ kind: "SKILL", refKey: s.agent, name: `${s.agent} skill`, source: "EVOLUTION", description: `Versioned system prompt for ${s.agent} (evolves from real outcomes)` }); if ("pluginId" in r) published++; }
  await emit({ agent: "MARKETPLACE", action: "PLUGIN_SYNC", detail: `synced ${published} new plugin(s) from real artifacts`, level: "INFO", category: "SYSTEM" });
  return { published };
}

/** Real per-workflow outcomes from each workflow's own reality table. Some
 *  workflows have no failure state in their rows (every run records a valid
 *  outcome) — their perf honestly reflects that rather than inventing failures. */
async function workflowStats(refKey: string): Promise<{ invocations: number; successes: number }> {
  switch (refKey) {
    case "createCompany": {
      const rows = await db.ventureRun.findMany({ select: { status: true } });
      return { invocations: rows.length, successes: rows.filter((r) => r.status !== "FAILED").length };
    }
    case "arena": {
      const rows = await db.arenaCompetition.findMany({ select: { status: true } });
      return { invocations: rows.length, successes: rows.filter((r) => r.status === "JUDGED").length };
    }
    case "acquisition": {
      const rows = await db.growthExperiment.findMany({ where: { experimentId: { not: null } }, select: { status: true, learning: true } });
      return { invocations: rows.length, successes: rows.filter((r) => r.learning !== null || r.status.startsWith("AWAITING")).length };
    }
    case "operator": {
      const n = await db.longMission.count();
      return { invocations: n, successes: n }; // missions have no crash state; KILLED/COMPLETED are both valid outcomes
    }
    case "world-scan": {
      const n = await db.worldProblem.count();
      return { invocations: n, successes: n };
    }
    case "demand": {
      const n = await db.demandMatch.count();
      return { invocations: n, successes: n };
    }
    default: return { invocations: 0, successes: 0 };
  }
}

/** Read REAL usage for the wrapped artifact and recompute performance + trust. */
export async function refreshStats(pluginId: string): Promise<void> {
  const p = await db.plugin.findUnique({ where: { pluginId } });
  if (!p) return;
  let invocations = 0, successes = 0, failures = 0;
  if (p.kind === "AGENT") {
    const execs = await db.agentExecution.findMany({ where: { agent: p.refKey.toUpperCase() }, select: { status: true } });
    invocations = execs.length; successes = execs.filter((e) => e.status === "SUCCESS").length; failures = execs.filter((e) => e.status === "FAILED").length;
  } else if (p.kind === "TOOL") {
    const calls = await db.toolCall.findMany({ where: { tool: p.refKey }, select: { status: true } });
    invocations = calls.length; successes = calls.filter((c) => c.status === "SUCCESS").length; failures = calls.filter((c) => c.status === "ERROR" || c.status === "FAILED").length;
  } else if (p.kind === "SKILL") {
    // a skill's performance = the ACTIVE prompt version's real recorded outcomes
    const v = await db.promptVersion.findFirst({ where: { agent: p.refKey.toUpperCase(), active: true } });
    successes = v?.successCount ?? 0; failures = v?.failCount ?? 0; invocations = successes + failures;
  } else if (p.kind === "WORKFLOW") {
    const w = await workflowStats(p.refKey);
    invocations = w.invocations; successes = w.successes; failures = invocations - successes;
  }
  const performanceScore = invocations > 0 ? clamp((successes / invocations) * 100) : 0;
  const trustScore = computeTrust(p.source as PluginSource, performanceScore, invocations, p.benchmarkScore);
  await db.plugin.update({ where: { pluginId }, data: { invocations, successes, failures, performanceScore, trustScore } });
}

/** Trust = source baseline + performance damped by usage volume + benchmark. Unproven ⇒ low. */
export function computeTrust(source: PluginSource, performanceScore: number, invocations: number, benchmarkScore: number): number {
  const volumeConfidence = Math.min(invocations / 20, 1); // <20 real runs ⇒ discounted
  return clamp(SOURCE_BASELINE[source] * 0.4 + performanceScore * volumeConfidence * 0.45 + benchmarkScore * 0.15);
}

export async function refreshAll(): Promise<number> {
  const plugins = await db.plugin.findMany({ select: { pluginId: true } });
  for (const p of plugins) await refreshStats(p.pluginId);
  return plugins.length;
}

export async function installPlugin(pluginId: string): Promise<{ ok: boolean; installCount?: number; error?: string }> {
  const p = await db.plugin.findUnique({ where: { pluginId } });
  if (!p) return { ok: false, error: "not found" };
  if (p.status === "DEPRECATED") return { ok: false, error: "plugin is deprecated" };
  const updated = await db.plugin.update({ where: { pluginId }, data: { status: "INSTALLED", installCount: p.installCount + 1 } });
  await emit({ agent: "MARKETPLACE", action: "PLUGIN_INSTALL", detail: `${pluginId} installed (${updated.installCount})`, level: "SUCCESS", category: "SYSTEM" });
  return { ok: true, installCount: updated.installCount };
}

/** Uninstall: back to LISTED. The wrapped artifact keeps existing; only the install state changes. */
export async function uninstallPlugin(pluginId: string): Promise<{ ok: boolean; error?: string }> {
  const p = await db.plugin.findUnique({ where: { pluginId } });
  if (!p) return { ok: false, error: "not found" };
  if (p.status !== "INSTALLED") return { ok: false, error: `not installed (status: ${p.status})` };
  await db.plugin.update({ where: { pluginId }, data: { status: "LISTED" } });
  await emit({ agent: "MARKETPLACE", action: "PLUGIN_UNINSTALL", detail: `${pluginId} uninstalled (back to LISTED)`, level: "INFO", category: "SYSTEM" });
  return { ok: true };
}

/** Deprecate: keeps the row + its real history, but blocks future installs. */
export async function deprecatePlugin(pluginId: string, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const p = await db.plugin.findUnique({ where: { pluginId } });
  if (!p) return { ok: false, error: "not found" };
  if (p.status === "DEPRECATED") return { ok: true }; // idempotent
  await db.plugin.update({ where: { pluginId }, data: { status: "DEPRECATED" } });
  await emit({ agent: "MARKETPLACE", action: "PLUGIN_DEPRECATE", detail: `${pluginId} deprecated${reason ? `: ${reason}` : ""}`, level: "WARNING", category: "SYSTEM" });
  return { ok: true };
}

/** Publish a new version of a plugin (versioning). */
export async function publishVersion(pluginId: string, input: { changelog?: string; config?: Record<string, unknown> }): Promise<{ version: number } | { error: string }> {
  const p = await db.plugin.findUnique({ where: { pluginId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  if (!p) return { error: "not found" };
  const version = (p.versions[0]?.version ?? 0) + 1;
  await db.pluginVersion.updateMany({ where: { pluginId, active: true }, data: { active: false } });
  await db.pluginVersion.create({ data: { pluginId, version, changelog: input.changelog ?? `v${version}`, config: JSON.stringify(input.config ?? {}), active: true } });
  await db.plugin.update({ where: { pluginId }, data: { version } });
  return { version };
}

/** On-demand benchmark: measure the plugin's real performance now and record it. */
export async function benchmarkPlugin(pluginId: string): Promise<{ benchmarkScore: number } | { error: string }> {
  const p = await db.plugin.findUnique({ where: { pluginId } });
  if (!p) return { error: "not found" };
  await refreshStats(pluginId);
  let benchmarkScore = 0;
  if (p.kind === "AGENT") {
    const m = await computeAgentMetrics(p.refKey.toUpperCase(), 24 * 90); // 90-day window of real executions
    benchmarkScore = m ? clamp(m.successRate * 100) : 0;
  } else {
    const fresh = await db.plugin.findUnique({ where: { pluginId } });
    benchmarkScore = fresh?.performanceScore ?? 0;
  }
  const fresh = await db.plugin.findUnique({ where: { pluginId } });
  const trustScore = computeTrust(p.source as PluginSource, fresh?.performanceScore ?? 0, fresh?.invocations ?? 0, benchmarkScore);
  await db.plugin.update({ where: { pluginId }, data: { benchmarkScore, trustScore, benchmarkedAt: new Date() } });
  await emit({ agent: "MARKETPLACE", action: "PLUGIN_BENCHMARK", detail: `${pluginId} benchmarked: ${benchmarkScore}/100`, level: "INFO", category: "SYSTEM" });
  return { benchmarkScore };
}

export async function rankPlugins(opts?: { kind?: PluginKind; limit?: number; refresh?: boolean }): Promise<unknown[]> {
  if (opts?.refresh) await refreshAll();
  const plugins = await db.plugin.findMany({ where: opts?.kind ? { kind: opts.kind } : undefined, orderBy: [{ trustScore: "desc" }, { performanceScore: "desc" }], take: opts?.limit ?? 50 });
  return plugins;
}
