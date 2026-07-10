/** Multi-Provider Model Router V2 (V9 multi-brain) — registry-driven routing,
 *  importance-aware cost intelligence, Fallback 2.0, and measured learning.
 *
 *  Selection order for a call:
 *    1. explicit preferModels (e.g. per-boardroom-seat brains), resolved via the
 *       registry and filtered to configured providers;
 *    2. dynamic chain from the Model Registry: rankModels(capability) blends the
 *       curated tier with MEASURED reliability/latency/duel history — routing
 *       learns, no fixed opinions;
 *    3. static curated chain (baseline) when the registry is empty;
 *    4. emergency cheap model appended as the terminal hop.
 *
 *  Importance (cost intelligence): LOW routes as CHEAP regardless of agent;
 *  CRITICAL keeps the frontier chain; expected cost is estimated BEFORE the
 *  call and recorded next to the real cost.
 *
 *  Fallback 2.0: transient failure (429/5xx/timeout) → retry the same model
 *  once → next hop (same provider first by chain order) → cross-provider →
 *  emergency cheap. A mission never dies because one model failed.
 *
 *  Honesty: tokens are real; cost is a labelled estimate; every real outcome
 *  updates the registry's measured reliability/latency.
 */

import { db } from "@/lib/db";
import { callAnthropic, callOpenRouter, callZai, type LlmOptions, type LlmResult, type LlmProvider } from "../types";
import { rankModels, emergencyModel, recordModelOutcome, premiumMode, type Importance } from "../model-registry";

export type Capability = "REASONING" | "CODING" | "LONG_CONTEXT" | "CHEAP" | "DEFAULT";
export type RoutableProvider = Exclude<LlmProvider, "none">;
export type { Importance };

/** Per-agent capability routing (CEO/Board→reasoning, Eng→coding, Research→long-ctx, Memory→cheap). */
const AGENT_CAPABILITY: Record<string, Capability> = {
  CEO: "REASONING", BOARDROOM: "REASONING",
  ENGINEERING: "CODING", ARCHITECT: "CODING", QUALITY: "CODING", DEPLOYMENT: "CODING",
  RESEARCH: "LONG_CONTEXT", INTERNET: "LONG_CONTEXT", WORLD_SCANNER: "LONG_CONTEXT",
  MEMORY: "CHEAP", GROWTH: "CHEAP", DESIGN: "CHEAP", CUSTOMER: "CHEAP",
};
export function capabilityFor(agent: string): Capability {
  return AGENT_CAPABILITY[agent.toUpperCase()] ?? "DEFAULT";
}

export interface Hop { provider: RoutableProvider; model: string }

/** Static curated chains — the baseline when the registry is empty (verified slugs). */
const CHAINS: Record<Capability, Hop[]> = {
  REASONING: [
    { provider: "openrouter", model: "anthropic/claude-opus-4.8" },
    { provider: "anthropic", model: "claude-opus-4-8" },
    { provider: "openrouter", model: "openai/gpt-4o-mini" },
  ],
  CODING: [
    { provider: "openrouter", model: "anthropic/claude-sonnet-5" },
    { provider: "anthropic", model: "claude-sonnet-5" },
    { provider: "openrouter", model: "qwen/qwen-2.5-coder-32b-instruct" },
    { provider: "openrouter", model: "openai/gpt-4o-mini" },
  ],
  LONG_CONTEXT: [
    { provider: "openrouter", model: "google/gemini-3.5-flash" },
    { provider: "openrouter", model: "anthropic/claude-sonnet-5" },
    { provider: "openrouter", model: "openai/gpt-4o-mini" },
  ],
  CHEAP: [
    { provider: "openrouter", model: "openai/gpt-4o-mini" },
    { provider: "openrouter", model: "google/gemini-3.1-flash-lite" },
    { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
  ],
  DEFAULT: [
    { provider: "openrouter", model: "anthropic/claude-sonnet-5" },
    { provider: "anthropic", model: "claude-sonnet-5" },
    { provider: "openrouter", model: "openai/gpt-4o-mini" },
  ],
};

/** Static per-1M price fallback for models not (yet) in the registry. */
const MODEL_PRICES: Record<string, { in: number; out: number }> = {
  "claude-opus-4-8": { in: 15, out: 75 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-haiku-4-5-20251001": { in: 0.8, out: 4 },
  "anthropic/claude-opus-4.8": { in: 15, out: 75 },
  "anthropic/claude-sonnet-5": { in: 3, out: 15 },
  "anthropic/claude-haiku-4.5": { in: 0.8, out: 4 },
  "openai/gpt-5.5": { in: 10, out: 40 },
  "openai/gpt-4o-mini": { in: 0.15, out: 0.6 },
  "google/gemini-3.1-pro-preview": { in: 2.5, out: 12 },
  "google/gemini-3.5-flash": { in: 0.15, out: 0.6 },
  "google/gemini-3.1-flash-lite": { in: 0.05, out: 0.2 },
  "qwen/qwen3-coder": { in: 0.9, out: 0.9 },
  "qwen/qwen-2.5-coder-32b-instruct": { in: 0.9, out: 0.9 },
  "z-ai/glm-4.7": { in: 0.6, out: 2.2 },
  "deepseek/deepseek-v3.2": { in: 0.3, out: 1.2 },
};
export function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const p = MODEL_PRICES[model] ?? { in: 3, out: 12 };
  return Math.round(((promptTokens / 1e6) * p.in + (completionTokens / 1e6) * p.out) * 1e6) / 1e6;
}

/** Pre-call expected cost (cost intelligence): ~4 chars/token prompt + maxTokens ceiling. */
export function expectedCost(model: string, opts: LlmOptions): number {
  const promptTokens = Math.ceil((opts.system.length + opts.user.length) / 4);
  return estimateCost(model, promptTokens, opts.maxTokens ?? 1500);
}

export function availableProviders(): Set<RoutableProvider> {
  const s = new Set<RoutableProvider>();
  if (process.env.ANTHROPIC_API_KEY) s.add("anthropic");
  if (process.env.OPENROUTER_API_KEY) s.add("openrouter");
  if (process.env.ZAI_API_KEY) s.add("zai");
  return s;
}

/** FREE_GENESIS_MODE static baseline — verified $0 slugs (registry-empty fallback). */
const FREE_CHAINS: Record<Capability, Hop[]> = {
  REASONING: [
    { provider: "openrouter", model: "nousresearch/hermes-3-llama-3.1-405b:free" },
    { provider: "openrouter", model: "qwen/qwen3-next-80b-a3b-instruct:free" },
    { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free" },
  ],
  CODING: [
    { provider: "openrouter", model: "qwen/qwen3-coder:free" },
    { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free" },
  ],
  LONG_CONTEXT: [
    { provider: "openrouter", model: "qwen/qwen3-coder:free" }, // 1M ctx
    { provider: "openrouter", model: "qwen/qwen3-next-80b-a3b-instruct:free" },
  ],
  CHEAP: [
    { provider: "openrouter", model: "meta-llama/llama-3.2-3b-instruct:free" },
    { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free" },
  ],
  DEFAULT: [
    { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free" },
    { provider: "openrouter", model: "qwen/qwen3-next-80b-a3b-instruct:free" },
  ],
};

/** Static baseline chain (curated). Kept for tests/UI and as the registry-empty fallback.
 *  In FREE_GENESIS_MODE (PREMIUM_MODE unset) only $0 models are returned. */
export function resolveChain(agent: string): Hop[] {
  const avail = availableProviders();
  const table = premiumMode() ? CHAINS : FREE_CHAINS;
  return table[capabilityFor(agent)].filter((h) => avail.has(h.provider));
}

/** Registry-driven chain: measured ranking + importance shaping + emergency terminal hop. */
export async function resolveChainDynamic(agent: string, importance: Importance = "NORMAL", preferModels?: string[]): Promise<Hop[]> {
  const avail = availableProviders();
  if (avail.size === 0) return [];
  const capability = importance === "LOW" ? "CHEAP" : capabilityFor(agent);
  const hops: Hop[] = [];
  const seen = new Set<string>();
  const push = (provider: string, model: string) => {
    if (!seen.has(model) && avail.has(provider as RoutableProvider)) { hops.push({ provider: provider as RoutableProvider, model }); seen.add(model); }
  };

  // 1. explicit per-seat/per-call preferences, resolved via the registry
  //    (in FREE_GENESIS_MODE a paid preference simply doesn't resolve — no credits burned)
  if (preferModels?.length) {
    type Reg = { modelId: string; provider: string };
    const rows: Reg[] = await db.modelRegistry.findMany({ where: { modelId: { in: preferModels }, active: true, ...(premiumMode() ? {} : { free: true }) }, select: { modelId: true, provider: true } }).catch(() => [] as Reg[]);
    const byId = new Map(rows.map((r) => [r.modelId, r]));
    for (const m of preferModels) { const r = byId.get(m); if (r) push(r.provider, r.modelId); }
  }
  // 2. measured registry ranking
  const ranked = await rankModels(capability, { limit: importance === "CRITICAL" ? 4 : 3, providers: avail as Set<string> }).catch(() => []);
  for (const r of ranked) push(r.provider, r.modelId);
  // 3. static baseline if the registry gave us nothing
  if (hops.length === 0) return resolveChain(agent);
  // 4. emergency cheap terminal hop (Fallback 2.0 guarantee)
  const em = await emergencyModel(avail as Set<string>).catch(() => null);
  if (em) push(em.provider, em.modelId);
  return hops;
}

type Invoke = (provider: RoutableProvider, opts: LlmOptions, timeoutMs: number) => Promise<{ text: string; promptTokens: number; completionTokens: number }>;
const realInvoke: Invoke = (provider, opts, timeoutMs) =>
  provider === "anthropic" ? callAnthropic(opts, timeoutMs) : provider === "openrouter" ? callOpenRouter(opts, timeoutMs) : callZai(opts, timeoutMs);

const TRANSIENT = /(_429|_5\d\d|timeout|timed out|aborted|ECONN|fetch failed|overloaded)/i;

/** Tests must NEVER hit real model APIs unless a seam is injected (or explicitly
 *  opted in via GENESIS_TEST_ALLOW_LLM=1) — keeps the suite fast, free and honest. */
export function llmDisabled(): boolean {
  return process.env.NODE_ENV === "test" && process.env.GENESIS_TEST_ALLOW_LLM !== "1";
}

// FREE_GENESIS_MODE belt-and-braces: a hop may only execute in free mode if the
// model is verifiably $0 (":free" suffix, or registry-flagged free — cached 60s).
let freeSetCache: { set: Set<string>; at: number } | null = null;
async function isFreeModel(model: string): Promise<boolean> {
  if (model.endsWith(":free")) return true;
  if (!freeSetCache || Date.now() - freeSetCache.at > 60_000) {
    const rows = await db.modelRegistry.findMany({ where: { free: true }, select: { modelId: true } }).catch(() => [] as { modelId: string }[]);
    freeSetCache = { set: new Set(rows.map((r) => r.modelId)), at: Date.now() };
  }
  return freeSetCache.set.has(model);
}

export interface RoutedResult extends LlmResult { provider?: RoutableProvider; model?: string; capability: Capability; costUsd: number; expectedCostUsd?: number; fallbackDepth: number; retries?: number; importance?: Importance }

/**
 * Route an LLM call through preferences → measured chain → emergency, with
 * retry-once on transient failures. Records LlmUsage + updates the registry's
 * measured reliability/latency. `_invoke` is the injectable test seam.
 */
export async function callLlmRouted(
  opts: LlmOptions,
  ctx: { agent: string; executionId?: string; importance?: Importance; preferModels?: string[]; _invoke?: Invoke },
): Promise<RoutedResult> {
  const start = Date.now();
  const importance = ctx.importance ?? "NORMAL";
  const capability = importance === "LOW" ? "CHEAP" : capabilityFor(ctx.agent);
  if (!ctx._invoke && llmDisabled()) {
    return { ok: false, text: "", error: "LLM_DISABLED_IN_TESTS: inject _invoke or set GENESIS_TEST_ALLOW_LLM=1", durationMs: 0, capability, costUsd: 0, fallbackDepth: 0, importance };
  }
  const chain = await resolveChainDynamic(ctx.agent, importance, ctx.preferModels);
  const invoke = ctx._invoke ?? realInvoke;
  const timeoutMs = opts.timeoutMs ?? 8_000;

  if (chain.length === 0) {
    return { ok: false, text: "", error: "NO_PROVIDER: set ANTHROPIC_API_KEY or OPENROUTER_API_KEY", durationMs: Date.now() - start, capability, costUsd: 0, fallbackDepth: 0, importance };
  }

  let lastError = "";
  let totalRetries = 0;
  for (let depth = 0; depth < chain.length; depth++) {
    const hop = chain[depth];
    // Never burn credits accidentally: in free mode, refuse any non-$0 hop outright.
    if (!premiumMode() && !(await isFreeModel(hop.model))) { lastError = `SKIPPED_PAID_MODEL ${hop.model} (PREMIUM_MODE not enabled)`; continue; }
    const preEstimate = expectedCost(hop.model, opts);
    for (let attempt = 0; attempt < 2; attempt++) { // Fallback 2.0: retry the same model once on transient errors
      const t0 = Date.now();
      try {
        const r = await invoke(hop.provider, { ...opts, model: hop.model }, timeoutMs);
        if (!r.text) throw new Error("EMPTY_RESPONSE");
        const latency = Date.now() - t0;
        const totalTokens = r.promptTokens + r.completionTokens;
        const costUsd = estimateCost(hop.model, r.promptTokens, r.completionTokens);
        await recordUsage({ agent: ctx.agent, capability, provider: hop.provider, model: hop.model, promptTokens: r.promptTokens, completionTokens: r.completionTokens, totalTokens, costUsd, expectedCostUsd: preEstimate, importance, retries: totalRetries, ok: true, fallbackDepth: depth, durationMs: latency, executionId: ctx.executionId });
        await recordModelOutcome(hop.model, true, latency).catch(() => {});
        return { ok: true, text: r.text, tokensUsed: totalTokens || undefined, durationMs: Date.now() - start, provider: hop.provider, model: hop.model, capability, costUsd, expectedCostUsd: preEstimate, fallbackDepth: depth, retries: totalRetries, importance };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        await recordModelOutcome(hop.model, false, Date.now() - t0).catch(() => {});
        if (attempt === 0 && TRANSIENT.test(lastError)) {
          totalRetries++;
          // Backoff before the retry — an immediate retry of a 429 just 429s again.
          // Free-tier RPM limits need a longer breath.
          const backoff = /_429/.test(lastError) ? (premiumMode() ? 2_000 : 4_000) : 750;
          await new Promise((r) => setTimeout(r, backoff + Math.random() * 500));
          continue;
        }
        break;
      }
    }
  }
  await recordUsage({ agent: ctx.agent, capability, provider: chain[chain.length - 1].provider, model: chain[chain.length - 1].model, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0, expectedCostUsd: 0, importance, retries: totalRetries, ok: false, fallbackDepth: chain.length - 1, durationMs: Date.now() - start, error: lastError, executionId: ctx.executionId });
  return { ok: false, text: "", error: `all ${chain.length} hop(s) failed: ${lastError}`, durationMs: Date.now() - start, capability, costUsd: 0, fallbackDepth: chain.length - 1, retries: totalRetries, importance };
}

async function recordUsage(data: { agent: string; capability: string; provider: string; model: string; promptTokens: number; completionTokens: number; totalTokens: number; costUsd: number; expectedCostUsd: number; importance: string; retries: number; ok: boolean; fallbackDepth: number; durationMs: number; error?: string; executionId?: string }): Promise<void> {
  await db.llmUsage.create({ data: { ...data, error: data.error ?? null, executionId: data.executionId ?? null } }).catch(() => {});
}

/** Static routing table (baseline chains + availability) for the dashboard. */
export function routingTable(): { agent: string; capability: Capability; chain: (Hop & { available: boolean })[] }[] {
  const avail = availableProviders();
  const agents = [...new Set([...Object.keys(AGENT_CAPABILITY), "VENTURE", "OPPORTUNITY", "SECURITY"])];
  return agents.map((agent) => ({
    agent, capability: capabilityFor(agent),
    chain: CHAINS[capabilityFor(agent)].map((h) => ({ ...h, available: avail.has(h.provider) })),
  }));
}

/** Live routing table: what the registry-driven router would ACTUALLY use right now. */
export async function routingTableDynamic(): Promise<{ agent: string; capability: Capability; models: string[] }[]> {
  const agents = [...new Set([...Object.keys(AGENT_CAPABILITY), "VENTURE", "OPPORTUNITY"])];
  const out: { agent: string; capability: Capability; models: string[] }[] = [];
  for (const agent of agents) {
    const chain = await resolveChainDynamic(agent);
    out.push({ agent, capability: capabilityFor(agent), models: chain.map((h) => h.model) });
  }
  return out;
}

/** Aggregate real usage + estimated cost over a window. */
export async function usageSummary(windowHours = 24 * 30) {
  const since = new Date(Date.now() - windowHours * 3_600_000);
  const rows = await db.llmUsage.findMany({ where: { createdAt: { gte: since } } });
  const sum = (f: (r: typeof rows[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  const group = (key: (r: typeof rows[number]) => string) => {
    const m: Record<string, { calls: number; tokens: number; costUsd: number; failures: number }> = {};
    for (const r of rows) { const k = key(r); (m[k] ??= { calls: 0, tokens: 0, costUsd: 0, failures: 0 }); m[k].calls++; m[k].tokens += r.totalTokens; m[k].costUsd = Math.round((m[k].costUsd + r.costUsd) * 1e6) / 1e6; if (!r.ok) m[k].failures++; }
    return m;
  };
  return {
    calls: rows.length,
    okCalls: rows.filter((r) => r.ok).length,
    fallbackCalls: rows.filter((r) => r.ok && r.fallbackDepth > 0).length,
    retriedCalls: rows.filter((r) => (r.retries ?? 0) > 0).length,
    totalTokens: sum((r) => r.totalTokens),
    totalCostUsd: Math.round(sum((r) => r.costUsd) * 1e6) / 1e6,
    byProvider: group((r) => r.provider),
    byModel: group((r) => r.model),
    byAgent: group((r) => r.agent),
    costNote: "cost is an ESTIMATE (real tokens × published per-1M rates)",
  };
}
