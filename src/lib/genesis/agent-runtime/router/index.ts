/** Multi-Provider Model Router — per-agent routing + fallback chains + cost tracking.
 *
 * Extends (does not replace) the Anthropic adapter with OpenRouter and a router
 * that picks a model per agent's need and falls through a chain of providers:
 *
 *   capability(agent) → CHAINS[capability] (ordered [provider, model] list)
 *     → filter to providers with a configured key
 *     → try each in order: primary → next provider → cheap fallback
 *
 *   CEO / BOARDROOM   → REASONING     (strongest model)
 *   ENGINEERING / …   → CODING        (best coding model)
 *   RESEARCH / …      → LONG_CONTEXT  (long-context model)
 *   MEMORY / GROWTH…  → CHEAP         (cheap model)
 *   everything else   → DEFAULT
 *
 * Honesty: token counts are REAL (from the provider's usage); cost is an
 * ESTIMATE from a published price table (per-1M rates) and is labelled as such.
 * With no keys the router returns the honest NO_PROVIDER failure and agents use
 * their heuristic fallback exactly as before — nothing is fabricated.
 */

import { db } from "@/lib/db";
import { callAnthropic, callOpenRouter, callZai, type LlmOptions, type LlmResult, type LlmProvider } from "../types";

export type Capability = "REASONING" | "CODING" | "LONG_CONTEXT" | "CHEAP" | "DEFAULT";
export type RoutableProvider = Exclude<LlmProvider, "none">;

/** Per-agent capability routing (directive: CEO/Board→reasoning, Eng→coding, Research→long-ctx, Memory→cheap). */
const AGENT_CAPABILITY: Record<string, Capability> = {
  CEO: "REASONING", BOARDROOM: "REASONING",
  ENGINEERING: "CODING", ARCHITECT: "CODING", QUALITY: "CODING", DEPLOYMENT: "CODING",
  RESEARCH: "LONG_CONTEXT", INTERNET: "LONG_CONTEXT",
  MEMORY: "CHEAP", GROWTH: "CHEAP", DESIGN: "CHEAP",
};
export function capabilityFor(agent: string): Capability {
  return AGENT_CAPABILITY[agent.toUpperCase()] ?? "DEFAULT";
}

interface Hop { provider: RoutableProvider; model: string }

/** Fallback chains — OpenRouter-primary (verified slugs), then optional direct
 *  Anthropic, ending in a cheap model. A hop is only attempted if its provider
 *  has a configured key, so OpenRouter-only setups skip the anthropic-direct hops. */
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

/** Published per-1M-token rates (USD, ESTIMATE). Unknown models fall back to a mid estimate. */
const MODEL_PRICES: Record<string, { in: number; out: number }> = {
  "claude-opus-4-8": { in: 15, out: 75 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-haiku-4-5-20251001": { in: 0.8, out: 4 },
  "anthropic/claude-opus-4.8": { in: 15, out: 75 },
  "anthropic/claude-sonnet-5": { in: 3, out: 15 },
  "anthropic/claude-haiku-4.5": { in: 0.8, out: 4 },
  "openai/gpt-4o": { in: 2.5, out: 10 },
  "openai/gpt-4o-mini": { in: 0.15, out: 0.6 },
  "google/gemini-3.5-flash": { in: 0.15, out: 0.6 },
  "google/gemini-3.1-flash-lite": { in: 0.05, out: 0.2 },
  "qwen/qwen-2.5-coder-32b-instruct": { in: 0.9, out: 0.9 },
};
export function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const p = MODEL_PRICES[model] ?? { in: 3, out: 12 };
  return Math.round(((promptTokens / 1e6) * p.in + (completionTokens / 1e6) * p.out) * 1e6) / 1e6;
}

export function availableProviders(): Set<RoutableProvider> {
  const s = new Set<RoutableProvider>();
  if (process.env.ANTHROPIC_API_KEY) s.add("anthropic");
  if (process.env.OPENROUTER_API_KEY) s.add("openrouter");
  if (process.env.ZAI_API_KEY) s.add("zai");
  return s;
}

/** The attempt order for an agent: its capability chain filtered to configured providers. */
export function resolveChain(agent: string): Hop[] {
  const avail = availableProviders();
  return CHAINS[capabilityFor(agent)].filter((h) => avail.has(h.provider));
}

type Invoke = (provider: RoutableProvider, opts: LlmOptions, timeoutMs: number) => Promise<{ text: string; promptTokens: number; completionTokens: number }>;
const realInvoke: Invoke = (provider, opts, timeoutMs) =>
  provider === "anthropic" ? callAnthropic(opts, timeoutMs) : provider === "openrouter" ? callOpenRouter(opts, timeoutMs) : callZai(opts, timeoutMs);

export interface RoutedResult extends LlmResult { provider?: RoutableProvider; model?: string; capability: Capability; costUsd: number; fallbackDepth: number }

/**
 * Route an LLM call for an agent through its fallback chain, recording real
 * token usage + estimated cost. `_invoke` is an injectable seam for tests.
 */
export async function callLlmRouted(opts: LlmOptions, ctx: { agent: string; executionId?: string; _invoke?: Invoke }): Promise<RoutedResult> {
  const start = Date.now();
  const capability = capabilityFor(ctx.agent);
  const chain = resolveChain(ctx.agent);
  const invoke = ctx._invoke ?? realInvoke;
  const timeoutMs = opts.timeoutMs ?? 8_000;

  if (chain.length === 0) {
    return { ok: false, text: "", error: "NO_PROVIDER: set ANTHROPIC_API_KEY or OPENROUTER_API_KEY", durationMs: Date.now() - start, capability, costUsd: 0, fallbackDepth: 0 };
  }

  let lastError = "";
  for (let depth = 0; depth < chain.length; depth++) {
    const hop = chain[depth];
    const t0 = Date.now();
    try {
      const r = await invoke(hop.provider, { ...opts, model: hop.model }, timeoutMs);
      if (!r.text) throw new Error("EMPTY_RESPONSE");
      const totalTokens = r.promptTokens + r.completionTokens;
      const costUsd = estimateCost(hop.model, r.promptTokens, r.completionTokens);
      await recordUsage({ agent: ctx.agent, capability, provider: hop.provider, model: hop.model, promptTokens: r.promptTokens, completionTokens: r.completionTokens, totalTokens, costUsd, ok: true, fallbackDepth: depth, durationMs: Date.now() - t0, executionId: ctx.executionId });
      return { ok: true, text: r.text, tokensUsed: totalTokens || undefined, durationMs: Date.now() - start, provider: hop.provider, model: hop.model, capability, costUsd, fallbackDepth: depth };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e); // try the next hop
    }
  }
  // Whole chain failed — record the honest failure (no billable tokens).
  await recordUsage({ agent: ctx.agent, capability, provider: chain[chain.length - 1].provider, model: chain[chain.length - 1].model, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0, ok: false, fallbackDepth: chain.length - 1, durationMs: Date.now() - start, error: lastError, executionId: ctx.executionId });
  return { ok: false, text: "", error: `all ${chain.length} provider(s) failed: ${lastError}`, durationMs: Date.now() - start, capability, costUsd: 0, fallbackDepth: chain.length - 1 };
}

async function recordUsage(data: { agent: string; capability: string; provider: string; model: string; promptTokens: number; completionTokens: number; totalTokens: number; costUsd: number; ok: boolean; fallbackDepth: number; durationMs: number; error?: string; executionId?: string }): Promise<void> {
  await db.llmUsage.create({ data: { ...data, error: data.error ?? null, executionId: data.executionId ?? null } }).catch(() => {});
}

/** The routing table — per-agent capability + fallback chain, marking which hops are currently usable. */
export function routingTable(): { agent: string; capability: Capability; chain: (Hop & { available: boolean })[] }[] {
  const avail = availableProviders();
  const agents = [...new Set([...Object.keys(AGENT_CAPABILITY), "VENTURE", "CUSTOMER", "OPPORTUNITY", "SECURITY"])];
  return agents.map((agent) => ({
    agent, capability: capabilityFor(agent),
    chain: CHAINS[capabilityFor(agent)].map((h) => ({ ...h, available: avail.has(h.provider) })),
  }));
}

/** Aggregate real usage + estimated cost over a window. */
export async function usageSummary(windowHours = 24 * 30) {
  const since = new Date(Date.now() - windowHours * 3_600_000);
  const rows = await db.llmUsage.findMany({ where: { createdAt: { gte: since } } });
  const sum = (f: (r: typeof rows[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  const group = (key: (r: typeof rows[number]) => string) => {
    const m: Record<string, { calls: number; tokens: number; costUsd: number }> = {};
    for (const r of rows) { const k = key(r); (m[k] ??= { calls: 0, tokens: 0, costUsd: 0 }); m[k].calls++; m[k].tokens += r.totalTokens; m[k].costUsd = Math.round((m[k].costUsd + r.costUsd) * 1e6) / 1e6; }
    return m;
  };
  return {
    calls: rows.length,
    okCalls: rows.filter((r) => r.ok).length,
    fallbackCalls: rows.filter((r) => r.ok && r.fallbackDepth > 0).length,
    totalTokens: sum((r) => r.totalTokens),
    totalCostUsd: Math.round(sum((r) => r.costUsd) * 1e6) / 1e6,
    byProvider: group((r) => r.provider),
    byModel: group((r) => r.model),
    byAgent: group((r) => r.agent),
    costNote: "cost is an ESTIMATE (real tokens × published per-1M rates)",
  };
}
