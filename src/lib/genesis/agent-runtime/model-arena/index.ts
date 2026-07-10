/** V9 Model Arena — internal model competition.
 *
 * Same task → multiple models answer → a judge compares → winner stored.
 * The RULE judge is honest and deterministic: when the task has a checkable
 * expected answer, correctness gates the ranking; ties break on speed, then
 * cost. There is no fabricated quality score — a duel without a checkable
 * answer ranks only on ok/speed/cost and says so (`judgedBy: RULE`).
 *
 * Results feed the registry (wins/losses + reliability/latency via
 * recordModelOutcome), so future routing LEARNS from measured performance —
 * Phase 4 auto-selection and the Phase 8 benchmark hook both run through here.
 */

import { db } from "@/lib/db";
import { callOpenRouter, callAnthropic, type LlmOptions } from "../types";
import { recordModelOutcome, recordDuelResult, rankModels } from "../model-registry";
import { estimateCost, availableProviders } from "../router";
import { emit } from "../event-bus";

export type DuelCategory = "CODING" | "RESEARCH" | "BUSINESS" | "STRATEGY" | "PLANNING" | "DEBUGGING" | "GENERAL";

export interface DuelEntry { model: string; ok: boolean; latencyMs: number; tokens: number; costUsd: number; answer: string; correct?: boolean; score: number }
export interface DuelResult { duelId: string; task: string; category: DuelCategory; winner: string | null; rationale: string; entries: DuelEntry[] }

type Invoke = (provider: string, opts: LlmOptions, timeoutMs: number) => Promise<{ text: string; promptTokens: number; completionTokens: number }>;
const realInvoke: Invoke = (provider, opts, timeoutMs) => (provider === "anthropic" ? callAnthropic(opts, timeoutMs) : callOpenRouter(opts, timeoutMs));

async function nextDuelId(): Promise<string> {
  const rows = await db.modelDuel.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { duelId: true } });
  let max = 0; for (const r of rows) { const m = r.duelId.match(/^DUEL-(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `DUEL-${(max + 1).toString().padStart(6, "0")}`;
}

export interface RunDuelInput {
  task: string;
  category?: DuelCategory;
  models: string[]; // registry modelIds
  /** Checkable answer: the response must contain this (case-insensitive) to count as correct. */
  expected?: string;
  system?: string;
  maxTokens?: number;
  timeoutMs?: number;
  _invoke?: Invoke; // test seam
}

/** Run one duel: every model answers the same task; the RULE judge ranks. */
export async function runModelDuel(input: RunDuelInput): Promise<DuelResult> {
  const invoke = input._invoke ?? realInvoke;
  const category = input.category ?? "GENERAL";
  const providers = availableProviders();
  const rows = await db.modelRegistry.findMany({ where: { modelId: { in: input.models }, active: true } });
  const usable = rows.filter((r) => providers.has(r.provider as never));
  if (usable.length < 2) throw new Error(`need ≥2 usable models, got ${usable.length} (of ${input.models.length} requested)`);

  const entries: DuelEntry[] = [];
  for (const m of usable) {
    const t0 = Date.now();
    try {
      const r = await invoke(m.provider, { system: input.system ?? "Answer concisely.", user: input.task, maxTokens: input.maxTokens ?? 300, temperature: 0.2, model: m.modelId }, input.timeoutMs ?? 25_000);
      const latencyMs = Date.now() - t0;
      const tokens = r.promptTokens + r.completionTokens;
      const costUsd = estimateCost(m.modelId, r.promptTokens, r.completionTokens);
      const correct = input.expected !== undefined ? r.text.toLowerCase().includes(input.expected.toLowerCase()) : undefined;
      entries.push({ model: m.modelId, ok: true, latencyMs, tokens, costUsd, answer: r.text.slice(0, 400), correct, score: 0 });
      await recordModelOutcome(m.modelId, true, latencyMs);
    } catch (e) {
      entries.push({ model: m.modelId, ok: false, latencyMs: Date.now() - t0, tokens: 0, costUsd: 0, answer: `ERROR: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`, correct: input.expected !== undefined ? false : undefined, score: 0 });
      await recordModelOutcome(m.modelId, false, Date.now() - t0);
    }
  }

  // RULE judge: correctness (when checkable) → speed → cost.
  const maxLat = Math.max(...entries.map((e) => e.latencyMs), 1);
  const maxCost = Math.max(...entries.map((e) => e.costUsd), 1e-9);
  for (const e of entries) {
    if (!e.ok) { e.score = 0; continue; }
    const correctness = input.expected === undefined ? 50 : e.correct ? 100 : 0;
    const speed = Math.round((1 - e.latencyMs / maxLat) * 30);
    const thrift = Math.round((1 - e.costUsd / maxCost) * 20);
    e.score = Math.max(1, correctness === 0 && input.expected !== undefined ? 5 : Math.round(correctness * 0.5 + speed + thrift));
  }
  entries.sort((a, b) => b.score - a.score || a.latencyMs - b.latencyMs);
  const winner = entries[0]?.ok ? entries[0].model : null;
  const rationale = winner
    ? `${winner} wins ${category}: ${input.expected !== undefined ? `${entries[0].correct ? "correct answer" : "no correct answers — least-bad"}` : "no checkable answer — ranked on ok/speed/cost"}, ${entries[0].latencyMs}ms, ~$${entries[0].costUsd}.`
    : "no model produced a valid answer.";

  const duelId = await nextDuelId();
  await db.modelDuel.create({ data: { duelId, task: input.task.slice(0, 400), category, entries: JSON.stringify(entries), winner, judgedBy: "RULE", rationale } });
  await recordDuelResult(winner, entries.filter((e) => e.model !== winner).map((e) => e.model));
  await emit({ agent: "MODEL_ARENA", action: "DUEL", detail: `${duelId} [${category}] ${entries.length} models → ${winner ?? "no winner"}`, level: winner ? "SUCCESS" : "WARNING", category: "SYSTEM" });
  return { duelId, task: input.task, category, winner, rationale, entries };
}

/** Phase 8 — benchmark ↔ router: a standard checkable duel set per category.
 *  Run weekly via cron: POST /api/genesis/models {action:"benchmark"}. Updates
 *  registry wins/losses + reliability, which future routing reads. */
export const STANDARD_DUELS: { category: DuelCategory; task: string; expected: string }[] = [
  { category: "CODING", task: "What does this JavaScript return? [3,1,2].sort().at(-1) — reply with just the value.", expected: "3" },
  { category: "DEBUGGING", task: "This JS throws: JSON.parse(\"{'a':1}\") — name the root cause in a few words.", expected: "quote" },
  { category: "RESEARCH", task: "Extract the year from: 'The company, founded in 2017 in Oslo, pivoted twice.' Reply with just the year.", expected: "2017" },
  { category: "BUSINESS", task: "A product costs $10/mo with 5% monthly churn. Average customer lifetime in months? Reply with just the number.", expected: "20" },
  { category: "PLANNING", task: "Task A takes 3 days, B needs A and takes 2, C is parallel to B and takes 4. Minimum total days? Just the number.", expected: "7" },
];

export async function runModelBenchmark(opts?: { modelsPerDuel?: number; _invoke?: Invoke }): Promise<{ duels: DuelResult[]; leaderboard: { model: string; wins: number }[] }> {
  const duels: DuelResult[] = [];
  for (const d of STANDARD_DUELS) {
    const cap = d.category === "CODING" || d.category === "DEBUGGING" ? "CODING" : d.category === "RESEARCH" ? "LONG_CONTEXT" : "REASONING";
    const ranked = await rankModels(cap, { limit: opts?.modelsPerDuel ?? 3, providers: availableProviders() as Set<string> });
    if (ranked.length < 2) continue;
    try {
      duels.push(await runModelDuel({ task: d.task, category: d.category, expected: d.expected, models: ranked.map((r) => r.modelId), _invoke: opts?._invoke }));
    } catch { /* skip duels that can't run */ }
  }
  const wins = new Map<string, number>();
  for (const d of duels) if (d.winner) wins.set(d.winner, (wins.get(d.winner) ?? 0) + 1);
  const leaderboard = [...wins.entries()].map(([model, w]) => ({ model, wins: w })).sort((a, b) => b.wins - a.wins);
  await emit({ agent: "MODEL_ARENA", action: "BENCHMARK", detail: `models benchmark: ${duels.length} duels, top: ${leaderboard[0]?.model ?? "—"}`, level: "INFO", category: "SYSTEM" });
  return { duels, leaderboard };
}
