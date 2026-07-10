/** V9 Model Registry Engine — the dynamic brain catalog.
 *
 * Replaces hardcoded chains as the source of truth for which models exist and
 * how good they are. Each model carries curated tiers (reasoning/coding/
 * research — editable estimates, never fixed forever) plus MEASURED fields
 * (reliability EWMA, rolling latency, arena wins/losses) that only real calls
 * update. Availability + real prices sync from OpenRouter's live catalog, so a
 * model that disappears upstream is deactivated instead of silently failing.
 *
 * Selection = curated tier blended with measured history ("no fixed opinions"):
 *   effectiveScore = tier(capability) × (0.55 + 0.45 × reliability/100) − latencyPenalty
 * A model that keeps failing or crawling loses its seat regardless of its tier.
 */

import { db } from "@/lib/db";
import { emit } from "../event-bus";

export type ModelCapability = "REASONING" | "CODING" | "LONG_CONTEXT" | "CHEAP" | "DEFAULT";
export type Importance = "LOW" | "NORMAL" | "CRITICAL";

export interface SeedProfile {
  modelId: string; family: string; provider: "openrouter" | "anthropic"; name: string;
  contextLength: number; promptPrice: number; completionPrice: number;
  reasoningTier: number; codingTier: number; researchTier: number;
  strengths: string[]; weaknesses: string[]; tags: string[];
}

/** Curated frontier profiles (verified live on this OpenRouter account where possible).
 *  These are STARTING estimates — sync + measurement overwrite them over time. */
export const CURATED_SEED: SeedProfile[] = [
  { modelId: "anthropic/claude-opus-4.8", family: "CLAUDE", provider: "openrouter", name: "Claude Opus 4.8", contextLength: 200_000, promptPrice: 15, completionPrice: 75, reasoningTier: 97, codingTier: 92, researchTier: 88, strengths: ["deep strategy", "hard reasoning", "long-horizon planning"], weaknesses: ["cost"], tags: ["frontier", "reasoning"] },
  { modelId: "anthropic/claude-sonnet-5", family: "CLAUDE", provider: "openrouter", name: "Claude Sonnet 5", contextLength: 200_000, promptPrice: 3, completionPrice: 15, reasoningTier: 90, codingTier: 93, researchTier: 85, strengths: ["coding", "balanced cost/quality"], weaknesses: [], tags: ["coding"] },
  { modelId: "anthropic/claude-haiku-4.5", family: "CLAUDE", provider: "openrouter", name: "Claude Haiku 4.5", contextLength: 200_000, promptPrice: 0.8, completionPrice: 4, reasoningTier: 74, codingTier: 76, researchTier: 70, strengths: ["speed", "cost"], weaknesses: ["depth"], tags: ["cheap", "fast"] },
  { modelId: "openai/gpt-5.5", family: "GPT", provider: "openrouter", name: "GPT-5.5", contextLength: 400_000, promptPrice: 10, completionPrice: 40, reasoningTier: 95, codingTier: 89, researchTier: 86, strengths: ["reasoning", "breadth"], weaknesses: ["cost"], tags: ["frontier", "reasoning"] },
  { modelId: "openai/gpt-4o-mini", family: "GPT", provider: "openrouter", name: "GPT-4o mini", contextLength: 128_000, promptPrice: 0.15, completionPrice: 0.6, reasoningTier: 68, codingTier: 66, researchTier: 62, strengths: ["cost", "reliability"], weaknesses: ["depth"], tags: ["cheap", "emergency"] },
  { modelId: "google/gemini-3.1-pro-preview", family: "GEMINI", provider: "openrouter", name: "Gemini 3.1 Pro", contextLength: 1_000_000, promptPrice: 2.5, completionPrice: 12, reasoningTier: 91, codingTier: 84, researchTier: 95, strengths: ["huge context", "extraction"], weaknesses: ["preview stability"], tags: ["long-context", "research"] },
  { modelId: "google/gemini-3.5-flash", family: "GEMINI", provider: "openrouter", name: "Gemini 3.5 Flash", contextLength: 1_000_000, promptPrice: 0.15, completionPrice: 0.6, reasoningTier: 80, codingTier: 75, researchTier: 88, strengths: ["long context", "speed", "cost"], weaknesses: [], tags: ["long-context", "cheap"] },
  { modelId: "google/gemini-3.1-flash-lite", family: "GEMINI", provider: "openrouter", name: "Gemini 3.1 Flash Lite", contextLength: 1_000_000, promptPrice: 0.05, completionPrice: 0.2, reasoningTier: 62, codingTier: 58, researchTier: 72, strengths: ["cost"], weaknesses: ["depth"], tags: ["cheap", "emergency"] },
  { modelId: "qwen/qwen3-coder", family: "QWEN", provider: "openrouter", name: "Qwen3 Coder", contextLength: 256_000, promptPrice: 0.9, completionPrice: 0.9, reasoningTier: 72, codingTier: 90, researchTier: 60, strengths: ["coding", "cost"], weaknesses: ["non-code tasks"], tags: ["coding"] },
  { modelId: "qwen/qwen-2.5-coder-32b-instruct", family: "QWEN", provider: "openrouter", name: "Qwen 2.5 Coder 32B", contextLength: 128_000, promptPrice: 0.9, completionPrice: 0.9, reasoningTier: 62, codingTier: 82, researchTier: 50, strengths: ["coding", "cost"], weaknesses: ["reasoning"], tags: ["coding", "cheap"] },
  { modelId: "z-ai/glm-4.7", family: "GLM", provider: "openrouter", name: "GLM 4.7", contextLength: 200_000, promptPrice: 0.6, completionPrice: 2.2, reasoningTier: 80, codingTier: 86, researchTier: 70, strengths: ["coding", "cost"], weaknesses: [], tags: ["coding"] },
  { modelId: "deepseek/deepseek-v3.2", family: "DEEPSEEK", provider: "openrouter", name: "DeepSeek V3.2", contextLength: 164_000, promptPrice: 0.3, completionPrice: 1.2, reasoningTier: 84, codingTier: 85, researchTier: 72, strengths: ["cost/perf ratio"], weaknesses: ["latency spikes"], tags: ["coding", "reasoning"] },
  // Direct-Anthropic rows (used only when ANTHROPIC_API_KEY is set)
  { modelId: "claude-opus-4-8", family: "CLAUDE", provider: "anthropic", name: "Claude Opus 4.8 (direct)", contextLength: 200_000, promptPrice: 15, completionPrice: 75, reasoningTier: 97, codingTier: 92, researchTier: 88, strengths: ["deep strategy"], weaknesses: ["cost"], tags: ["frontier"] },
  { modelId: "claude-sonnet-5", family: "CLAUDE", provider: "anthropic", name: "Claude Sonnet 5 (direct)", contextLength: 200_000, promptPrice: 3, completionPrice: 15, reasoningTier: 90, codingTier: 93, researchTier: 85, strengths: ["coding"], weaknesses: [], tags: ["coding"] },
];

export async function seedRegistry(): Promise<number> {
  let n = 0;
  for (const p of CURATED_SEED) {
    await db.modelRegistry.upsert({
      where: { modelId: p.modelId },
      create: { modelId: p.modelId, family: p.family, provider: p.provider, name: p.name, contextLength: p.contextLength, promptPrice: p.promptPrice, completionPrice: p.completionPrice, reasoningTier: p.reasoningTier, codingTier: p.codingTier, researchTier: p.researchTier, strengths: JSON.stringify(p.strengths), weaknesses: JSON.stringify(p.weaknesses), tags: JSON.stringify(p.tags), source: "seed" },
      update: {}, // never clobber measured/synced state on reseed
    });
    n++;
  }
  return n;
}

/** Sync availability + real prices from OpenRouter's live catalog. Injectable fetch for tests. */
export async function syncWithCatalog(fetchCatalog?: () => Promise<{ id: string; context_length?: number; pricing?: { prompt?: string; completion?: string } }[]>): Promise<{ activated: number; deactivated: number; priced: number }> {
  const load = fetchCatalog ?? (async () => {
    const res = await fetch("https://openrouter.ai/api/v1/models", { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? ""}` } });
    if (!res.ok) throw new Error(`OPENROUTER_HTTP_${res.status}`);
    return ((await res.json()) as { data: { id: string; context_length?: number; pricing?: { prompt?: string; completion?: string } }[] }).data;
  });
  const catalog = await load();
  const byId = new Map(catalog.map((m) => [m.id, m]));
  const rows = await db.modelRegistry.findMany({ where: { provider: "openrouter" } });
  let activated = 0, deactivated = 0, priced = 0;
  for (const row of rows) {
    const live = byId.get(row.modelId);
    if (!live) {
      if (row.active) { await db.modelRegistry.update({ where: { id: row.id }, data: { active: false } }); deactivated++; }
      continue;
    }
    const promptPrice = live.pricing?.prompt ? parseFloat(live.pricing.prompt) * 1e6 : row.promptPrice;
    const completionPrice = live.pricing?.completion ? parseFloat(live.pricing.completion) * 1e6 : row.completionPrice;
    await db.modelRegistry.update({ where: { id: row.id }, data: { active: true, source: "openrouter", contextLength: live.context_length ?? row.contextLength, promptPrice, completionPrice } });
    activated++; if (live.pricing?.prompt) priced++;
  }
  await emit({ agent: "MODEL_REGISTRY", action: "SYNC", detail: `catalog sync: ${activated} active, ${deactivated} deactivated, ${priced} repriced`, level: "INFO", category: "SYSTEM" });
  return { activated, deactivated, priced };
}

type Row = NonNullable<Awaited<ReturnType<typeof db.modelRegistry.findFirst>>>;

function tierFor(row: Row, cap: ModelCapability): number {
  if (cap === "CODING") return row.codingTier;
  if (cap === "LONG_CONTEXT") return row.researchTier;
  if (cap === "CHEAP") {
    // cheap = value: capability per dollar (blended tier / price), normalized to ~0-100
    const blended = (row.reasoningTier + row.codingTier + row.researchTier) / 3;
    const price = Math.max(0.05, row.promptPrice + row.completionPrice);
    return Math.min(100, Math.round((blended / price) * 6));
  }
  if (cap === "REASONING") return row.reasoningTier;
  return Math.round(row.reasoningTier * 0.5 + row.codingTier * 0.3 + row.researchTier * 0.2);
}

/** Curated tier blended with MEASURED reliability + latency — auto selection, no fixed opinions. */
export function effectiveScore(row: Row, cap: ModelCapability): number {
  const tier = tierFor(row, cap);
  const reliabilityFactor = 0.55 + 0.45 * (row.reliability / 100);
  const latencyPenalty = row.avgLatencyMs > 20_000 ? 10 : row.avgLatencyMs > 8_000 ? 4 : 0;
  const duelBonus = Math.min(5, Math.max(-5, (row.measuredWins - row.measuredLosses)));
  return Math.round(tier * reliabilityFactor - latencyPenalty + duelBonus);
}

export interface RankedModel { modelId: string; provider: string; score: number; promptPrice: number; completionPrice: number; reliability: number; avgLatencyMs: number }

export async function rankModels(cap: ModelCapability, opts?: { limit?: number; providers?: Set<string> }): Promise<RankedModel[]> {
  const rows = await db.modelRegistry.findMany({ where: { active: true } });
  const usable = rows.filter((r) => !opts?.providers || opts.providers.has(r.provider));
  return usable
    .map((r) => ({ modelId: r.modelId, provider: r.provider, score: effectiveScore(r, cap), promptPrice: r.promptPrice, completionPrice: r.completionPrice, reliability: r.reliability, avgLatencyMs: r.avgLatencyMs }))
    // deterministic: score desc → cheaper first → stable id order
    .sort((a, b) => b.score - a.score || (a.promptPrice + a.completionPrice) - (b.promptPrice + b.completionPrice) || a.modelId.localeCompare(b.modelId))
    .slice(0, opts?.limit ?? 10);
}

/** Record the outcome of a REAL call: reliability EWMA (α=0.15) + rolling latency. */
export async function recordModelOutcome(modelId: string, ok: boolean, latencyMs: number): Promise<void> {
  const row = await db.modelRegistry.findUnique({ where: { modelId } });
  if (!row) return;
  const reliability = Math.round((row.reliability * 0.85 + (ok ? 100 : 0) * 0.15) * 10) / 10;
  const avgLatencyMs = row.avgLatencyMs === 0 ? latencyMs : Math.round(row.avgLatencyMs * 0.8 + latencyMs * 0.2);
  await db.modelRegistry.update({ where: { modelId }, data: { reliability, ...(ok ? { avgLatencyMs } : {}) } }).catch(() => {});
}

export async function recordDuelResult(winnerId: string | null, loserIds: string[]): Promise<void> {
  if (winnerId) await db.modelRegistry.update({ where: { modelId: winnerId }, data: { measuredWins: { increment: 1 } } }).catch(() => {});
  for (const l of loserIds) await db.modelRegistry.update({ where: { modelId: l }, data: { measuredLosses: { increment: 1 } } }).catch(() => {});
}

/** Cheapest active model — the emergency terminal hop (Fallback 2.0). */
export async function emergencyModel(providers: Set<string>): Promise<RankedModel | null> {
  const rows = await db.modelRegistry.findMany({ where: { active: true } });
  const usable = rows.filter((r) => providers.has(r.provider) && r.reliability >= 30);
  if (!usable.length) return null;
  usable.sort((a, b) => (a.promptPrice + a.completionPrice) - (b.promptPrice + b.completionPrice));
  const r = usable[0];
  return { modelId: r.modelId, provider: r.provider, score: effectiveScore(r, "CHEAP"), promptPrice: r.promptPrice, completionPrice: r.completionPrice, reliability: r.reliability, avgLatencyMs: r.avgLatencyMs };
}
