/** LLM Provider Status (V8 force-multiplier) — honest degradation, made visible.
 *
 * Every "intelligent" gate falls back to a rule-based heuristic when no LLM
 * provider is configured. That degradation used to be silent; this surfaces it:
 *
 *   getProviderStatus — which provider is active, the model, and a capability
 *     matrix showing which gates are running REAL reasoning vs a HEURISTIC
 *     fallback right now (procedural-by-design gates are marked as such, NOT as
 *     degraded — that would be dishonest).
 *   checkProvider — a real minimal round-trip through the actual adapter
 *     (callLlm). With a key it proves real reasoning works + latency; without
 *     one it returns the adapter's honest NO_LLM_PROVIDER error.
 *
 * Setting ANTHROPIC_API_KEY (or ZAI_API_KEY) flips every LLM-gated gate from
 * HEURISTIC to LLM with zero code changes — this module just reports the truth.
 */

import { pickProvider, callLlm, type LlmProvider } from "../types";
import { availableProviders, routingTable, usageSummary } from "../router";
import { premiumMode } from "../model-registry";

const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-5";

/** Gates that call the LLM and fall back to a heuristic when there's no provider. */
const LLM_GATED = [
  { gate: "CEO decomposition", note: "goal → task plan" },
  { gate: "OPPORTUNITY", note: "opportunity synthesis" },
  { gate: "BUSINESS_VALIDATION", note: "demand/feasibility scoring" },
  { gate: "VENTURE", note: "7-dimension VC scoring" },
  { gate: "BOARDROOM", note: "nine-seat debate" },
  { gate: "ARENA teams", note: "ALPHA/BETA/GAMMA strategies (via VENTURE)" },
  { gate: "RESEARCH", note: "research synthesis" },
  { gate: "GROWTH", note: "GTM plan" },
  { gate: "ENGINEERING repair", note: "LLM patch loop" },
];
/** Gates that are deterministic BY DESIGN — not a degradation when there's no LLM. */
const PROCEDURAL = [
  { gate: "CUSTOMER simulation", note: "seeded personas — reproducible by design" },
  { gate: "DEMAND match", note: "keyword/affinity fit over the sim" },
  { gate: "AEGIS truth", note: "evidence arithmetic" },
  { gate: "BENCHMARK", note: "measures discrimination" },
];

export interface ProviderStatus {
  provider: LlmProvider; // legacy: the single provider callLlm() would use (Anthropic-first)
  providers: LlmProvider[]; // all configured providers the router can route to
  premiumMode: boolean; // false = FREE_GENESIS_MODE ($0 models only; credits never burned)
  model: string | null;
  degraded: boolean;
  reasoningMode: "LLM" | "HEURISTIC";
  summary: string;
  llmGated: { gate: string; note: string; mode: "LLM" | "HEURISTIC" }[];
  procedural: { gate: string; note: string }[];
  routing: ReturnType<typeof routingTable>;
  hint: string;
}

export function getProviderStatus(): ProviderStatus {
  const provider = pickProvider();
  const providers = [...availableProviders()] as LlmProvider[];
  const degraded = providers.length === 0;
  const model = provider === "anthropic" ? (process.env.GENESIS_LLM_MODEL ?? ANTHROPIC_DEFAULT_MODEL) : provider === "openrouter" ? "openrouter (routed per agent)" : provider === "zai" ? "z-ai" : null;
  const reasoningMode = degraded ? "HEURISTIC" : "LLM";
  return {
    provider, providers, model, degraded, reasoningMode, premiumMode: premiumMode(),
    summary: degraded
      ? "DEGRADED — no LLM provider configured; every LLM-gated gate is running its rule-based heuristic fallback."
      : `LLM ACTIVE — ${providers.join(" + ")} [${premiumMode() ? "PREMIUM" : "FREE_GENESIS_MODE ($0 models only)"}]; agents route per capability with provider fallback.`,
    llmGated: LLM_GATED.map((g) => ({ ...g, mode: reasoningMode })),
    procedural: PROCEDURAL,
    routing: routingTable(),
    hint: degraded ? "Set ANTHROPIC_API_KEY and/or OPENROUTER_API_KEY to activate real reasoning across all gates." : "Providers active. Add OPENROUTER_API_KEY for cross-provider fallback + more model choices.",
  };
}

/** Real token usage + estimated cost across the router. */
export async function getUsageSummary(windowHours?: number) {
  return usageSummary(windowHours);
}

export interface ProviderCheck {
  provider: LlmProvider; degraded: boolean; ok: boolean; latencyMs: number; model: string | null; sample?: string; error?: string;
}

/** Real round-trip through the actual adapter — proves reasoning works, or reports the honest failure. */
export async function checkProvider(): Promise<ProviderCheck> {
  const status = getProviderStatus();
  const t0 = Date.now();
  const r = await callLlm({ system: "You are a health check. Reply with exactly: OK", user: "ping", maxTokens: 8, temperature: 0, timeoutMs: 10_000 });
  return {
    provider: status.provider, degraded: status.degraded, model: status.model,
    ok: r.ok, latencyMs: Date.now() - t0,
    sample: r.ok ? r.text.trim().slice(0, 40) : undefined,
    error: r.ok ? undefined : r.error,
  };
}
