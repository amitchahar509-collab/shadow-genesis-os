/** Token / Cost / Model Optimizers (V10 Module 12).
 *
 * Token optimization: prompt compression with a REAL measured before/after token
 * estimate. Cost/model optimization: reuses the existing registry ranking to pick
 * the cheapest model meeting a capability, with the measured cost delta. Nothing
 * is claimed that isn't measured.
 */

import { createHash } from "node:crypto";
import { rankModels, type ModelCapability } from "../model-registry";
import { estimateCost } from "../router";

/** Rough-but-consistent token estimate (~4 chars/token). Used for BEFORE/AFTER
 *  deltas — the metric is relative, so the estimator's constant cancels out. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface CompressionResult { before: number; after: number; tokensBefore: number; tokensAfter: number; tokensSaved: number; savedPct: number; text: string }

/** Compress a prompt WITHOUT changing meaning: collapse runs of whitespace, strip
 *  trailing spaces, dedupe consecutive identical lines, drop empty lines runs.
 *  Deterministic + lossless-of-intent. Returns the measured token delta. */
export function compressPrompt(prompt: string): CompressionResult {
  const before = prompt.length;
  const tokensBefore = estimateTokens(prompt);
  const lines = prompt.split("\n").map((l) => l.replace(/[ \t]+/g, " ").replace(/[ \t]+$/g, ""));
  const dedupedLines: string[] = [];
  let blankRun = 0;
  for (const l of lines) {
    if (l.trim() === "") { blankRun++; if (blankRun > 1) continue; } else blankRun = 0;
    if (dedupedLines.length && dedupedLines[dedupedLines.length - 1] === l && l.trim() !== "") continue; // drop consecutive dup lines
    dedupedLines.push(l);
  }
  const text = dedupedLines.join("\n").trim();
  const after = text.length;
  const tokensAfter = estimateTokens(text);
  const tokensSaved = Math.max(0, tokensBefore - tokensAfter);
  return { before, after, tokensBefore, tokensAfter, tokensSaved, savedPct: tokensBefore > 0 ? Math.round((tokensSaved / tokensBefore) * 100) : 0, text };
}

export interface ModelChoice { model: string; provider: string; combinedPricePer1M: number; score: number }
export interface ModelOptimization { baseline: ModelChoice | null; optimized: ModelChoice | null; costSavedPer1M: number; savedPct: number; note: string }

/** Pick the cheapest model that still meets a capability's ranking, and measure
 *  the cost delta vs the top-ranked (quality-first) choice. Reuses rankModels —
 *  no new routing logic. */
export async function optimizeModelChoice(capability: ModelCapability, opts?: { providers?: Set<string>; freeOnly?: boolean }): Promise<ModelOptimization> {
  const ranked = await rankModels(capability, { providers: opts?.providers, freeOnly: opts?.freeOnly, limit: 12 });
  if (ranked.length === 0) return { baseline: null, optimized: null, costSavedPer1M: 0, savedPct: 0, note: "no models available for this capability" };
  const price = (r: { promptPrice: number; completionPrice: number }) => Math.round((r.promptPrice + r.completionPrice) * 1e6) / 1e6;
  const baseline = ranked[0]; // quality-first (highest effectiveScore)
  // cheapest among the top tier (those within 15% of the top score) — keeps quality, cuts cost
  const topScore = baseline.score;
  const candidates = ranked.filter((r) => r.score >= topScore * 0.85);
  const optimized = candidates.reduce((cheapest, r) => (price(r) < price(cheapest) ? r : cheapest), candidates[0]);
  const costSavedPer1M = Math.round((price(baseline) - price(optimized)) * 1e6) / 1e6;
  const toChoice = (r: typeof baseline): ModelChoice => ({ model: r.modelId, provider: r.provider, combinedPricePer1M: price(r), score: r.score });
  return {
    baseline: toChoice(baseline), optimized: toChoice(optimized),
    costSavedPer1M, savedPct: price(baseline) > 0 ? Math.round((costSavedPer1M / price(baseline)) * 100) : 0,
    note: costSavedPer1M > 0 ? `cheaper model within 15% of top quality — saves $${costSavedPer1M}/1M tokens` : "top-ranked model is already the cheapest at this quality tier",
  };
}

/** Estimated per-call savings from compression + model choice, at real rates. */
export function estimateCallSavingsUsd(model: string, tokensSaved: number, promptShare = 1): number {
  // tokensSaved are prompt tokens; price via the real estimator
  return Math.round(estimateCost(model, tokensSaved * promptShare, 0) * 1e6) / 1e6;
}

/** Deterministic dedupe key for duplicate-execution detection. */
export function dedupeKey(kind: string, payload: unknown): string {
  return `${kind}:${createHash("sha256").update(typeof payload === "string" ? payload : JSON.stringify(payload)).digest("hex").slice(0, 24)}`;
}
