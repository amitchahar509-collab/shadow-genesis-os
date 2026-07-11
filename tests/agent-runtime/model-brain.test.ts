/** V9 multi-brain tests: registry engine, measured learning, Fallback 2.0 retry, model arena, per-seat brains. Network-free. */

import { test, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { db } from "@/lib/db";
import { seedRegistry, syncWithCatalog, rankModels, effectiveScore, recordModelOutcome, emergencyModel, CURATED_SEED } from "@/lib/genesis/agent-runtime/model-registry";
import { callLlmRouted, resolveChainDynamic } from "@/lib/genesis/agent-runtime/router";
import { runModelDuel, runModelBenchmark, STANDARD_DUELS } from "@/lib/genesis/agent-runtime/model-arena";
import { SEAT_MODELS, BOARD } from "@/lib/genesis/agent-runtime/boardroom";
import type { LlmOptions } from "@/lib/genesis/agent-runtime/types";

const KEYS = ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "OLLAMA_HOST", "ZAI_API_KEY", "PREMIUM_MODE"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];
function setKeys(...on: string[]) { for (const k of KEYS) delete process.env[k]; for (const k of on) process.env[k] = "sk-test"; process.env.PREMIUM_MODE = "true"; /* these suites assert PREMIUM ranking */ }
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
// the catalog-sync test deactivates rows; don't rely on a later test's beforeEach to
// undo it — leave the registry sane for whichever suite runs next (order-independence)
afterAll(async () => { await seedRegistry(); await db.modelRegistry.updateMany({ data: { active: true } }); });
beforeEach(async () => {
  await seedRegistry();
  await db.modelRegistry.updateMany({ data: { reliability: 50, avgLatencyMs: 0, measuredWins: 0, measuredLosses: 0, active: true } });
  await db.modelDuel.deleteMany({ where: { task: { contains: "MBTEST" } } });
  await db.llmUsage.deleteMany({ where: { agent: { startsWith: "MBTEST" } } });
});

// ---- Phase 1: registry ----
test("registry seeds the directive's frontier families (Claude/GPT/Gemini/GLM/Qwen/DeepSeek/minis)", async () => {
  const rows = await db.modelRegistry.findMany();
  const families = new Set(rows.map((r) => r.family));
  for (const f of ["CLAUDE", "GPT", "GEMINI", "GLM", "QWEN", "DEEPSEEK"]) expect(families.has(f)).toBe(true);
  expect(rows.length).toBeGreaterThanOrEqual(CURATED_SEED.length);
  // replaceable, not hardcoded: rows are editable data
  await db.modelRegistry.update({ where: { modelId: "openai/gpt-4o-mini" }, data: { reasoningTier: 70 } });
  expect((await db.modelRegistry.findUnique({ where: { modelId: "openai/gpt-4o-mini" } }))!.reasoningTier).toBe(70);
});

test("catalog sync deactivates missing models and reprices from live data (injected)", async () => {
  const fake = async () => [
    { id: "anthropic/claude-opus-4.8", context_length: 200000, pricing: { prompt: "0.000015", completion: "0.000075" } },
    { id: "openai/gpt-4o-mini", context_length: 128000, pricing: { prompt: "0.00000015", completion: "0.0000006" } },
  ];
  const r = await syncWithCatalog(fake);
  expect(r.activated).toBe(2);
  expect(r.deactivated).toBeGreaterThan(0); // every other openrouter row deactivated
  const gone = await db.modelRegistry.findUnique({ where: { modelId: "qwen/qwen3-coder" } });
  expect(gone!.active).toBe(false);
  const opus = await db.modelRegistry.findUnique({ where: { modelId: "anthropic/claude-opus-4.8" } });
  expect(opus!.promptPrice).toBeCloseTo(15, 3); // real per-1M price from the catalog
});

test("measured learning changes ranking: a failing model loses its seat (no fixed opinions)", async () => {
  setKeys("OPENROUTER_API_KEY");
  const before = await rankModels("REASONING", { providers: new Set(["openrouter"]) });
  expect(before[0].modelId).toBe("anthropic/claude-opus-4.8");
  for (let i = 0; i < 25; i++) await recordModelOutcome("anthropic/claude-opus-4.8", false, 500); // real failures
  const after = await rankModels("REASONING", { providers: new Set(["openrouter"]) });
  expect(after[0].modelId).not.toBe("anthropic/claude-opus-4.8"); // reliability collapse dethrones it
  const row = await db.modelRegistry.findUnique({ where: { modelId: "anthropic/claude-opus-4.8" } });
  expect(row!.reliability).toBeLessThan(10);
});

test("effectiveScore penalizes slow models; emergencyModel picks the cheapest reliable one", async () => {
  const opus = (await db.modelRegistry.findUnique({ where: { modelId: "anthropic/claude-opus-4.8" } }))!;
  const fast = effectiveScore(opus, "REASONING");
  const slow = effectiveScore({ ...opus, avgLatencyMs: 30_000 }, "REASONING");
  expect(slow).toBeLessThan(fast);
  // Assert the PROPERTY (cheapest active by combined price), not a hardcoded model —
  // live catalog syncs overwrite seed prices with real ones, and that must win.
  const em = await emergencyModel(new Set(["openrouter"]));
  const all = await db.modelRegistry.findMany({ where: { active: true, provider: "openrouter" } });
  const cheapest = Math.min(...all.map((r) => r.promptPrice + r.completionPrice));
  expect(em!.promptPrice + em!.completionPrice).toBe(cheapest);
});

// ---- Phases 2+5+6: routing, importance, Fallback 2.0 ----
test("importance LOW routes a REASONING agent to cheap models (cost intelligence)", async () => {
  setKeys("OPENROUTER_API_KEY");
  const normal = await resolveChainDynamic("CEO", "NORMAL");
  const low = await resolveChainDynamic("CEO", "LOW");
  expect(normal[0].model).toBe("anthropic/claude-opus-4.8"); // frontier for the critical path
  expect(low[0].model).not.toBe("anthropic/claude-opus-4.8"); // cheap task → cheap model
  // Property, not a fixed list: the LOW primary must be dramatically cheaper than
  // the frontier primary (with FREE_SEED in the registry it's usually a $0 model).
  const rows = await db.modelRegistry.findMany({ where: { modelId: { in: [normal[0].model, low[0].model] } } });
  const price = (id: string) => { const r = rows.find((x) => x.modelId === id)!; return r.promptPrice + r.completionPrice; };
  expect(price(low[0].model)).toBeLessThan(price(normal[0].model) / 5);
});

test("preferModels (per-seat brain) is tried first, then the chain", async () => {
  setKeys("OPENROUTER_API_KEY");
  const chain = await resolveChainDynamic("BOARDROOM", "CRITICAL", ["qwen/qwen3-coder"]);
  expect(chain[0].model).toBe("qwen/qwen3-coder"); // seat preference leads
  expect(chain.length).toBeGreaterThan(1); // capability chain still follows as fallback
});

test("Fallback 2.0: transient failure retries the SAME model once before moving on", async () => {
  setKeys("OPENROUTER_API_KEY");
  let calls = 0;
  const invoke = async (_p: string, opts: LlmOptions) => {
    calls++;
    if (calls === 1) throw new Error("OPENROUTER_HTTP_429: rate limited"); // transient
    return { text: `ok from ${opts.model}`, promptTokens: 10, completionTokens: 5 };
  };
  const r = await callLlmRouted({ system: "s", user: "u" }, { agent: "MBTEST_retry", _invoke: invoke as never });
  expect(r.ok).toBe(true);
  expect(r.fallbackDepth).toBe(0); // same hop succeeded on retry
  expect(r.retries).toBe(1);
});

test("Fallback 2.0: hard failure does NOT retry; walks to the next hop and the emergency tail exists", async () => {
  setKeys("OPENROUTER_API_KEY");
  const models: string[] = [];
  const invoke = async (_p: string, opts: LlmOptions) => {
    models.push(opts.model!);
    if (models.length < 3) throw new Error("HTTP_400 bad request"); // non-transient
    return { text: "rescued", promptTokens: 5, completionTokens: 5 };
  };
  const r = await callLlmRouted({ system: "s", user: "u" }, { agent: "MBTEST_walk", _invoke: invoke as never });
  expect(r.ok).toBe(true);
  expect(r.fallbackDepth).toBe(2); // third hop rescued the call
  expect(new Set(models).size).toBe(models.length); // no same-model retry on hard errors
});

// ---- Phase 3: model arena ----
test("model duel: correct answer wins over wrong one; results stored + registry updated", async () => {
  setKeys("OPENROUTER_API_KEY");
  const invoke = async (_p: string, opts: LlmOptions) => {
    if (opts.model === "openai/gpt-4o-mini") return { text: "The answer is 42.", promptTokens: 20, completionTokens: 8 };
    return { text: "It is 41.", promptTokens: 20, completionTokens: 8 }; // wrong
  };
  const d = await runModelDuel({ task: "MBTEST what is 6*7? reply with the number", expected: "42", models: ["openai/gpt-4o-mini", "google/gemini-3.5-flash"], _invoke: invoke as never });
  expect(d.winner).toBe("openai/gpt-4o-mini"); // correctness gates the win — never faked
  const row = await db.modelDuel.findUnique({ where: { duelId: d.duelId } });
  expect(row!.judgedBy).toBe("RULE");
  const winner = await db.modelRegistry.findUnique({ where: { modelId: "openai/gpt-4o-mini" } });
  expect(winner!.measuredWins).toBe(1);
  const loser = await db.modelRegistry.findUnique({ where: { modelId: "google/gemini-3.5-flash" } });
  expect(loser!.measuredLosses).toBe(1);
});

test("models benchmark runs the standard checkable duel set and returns a leaderboard", async () => {
  setKeys("OPENROUTER_API_KEY");
  const invoke = async (_p: string, opts: LlmOptions) => {
    // one brain answers everything correctly; others are wrong → deterministic leaderboard
    if (opts.model === "anthropic/claude-opus-4.8" || opts.model === "anthropic/claude-sonnet-5") {
      const t = String(opts.user);
      const d = STANDARD_DUELS.find((x) => t.includes(x.task.slice(0, 30)));
      return { text: d?.expected ?? "?", promptTokens: 15, completionTokens: 5 };
    }
    return { text: "wrong", promptTokens: 15, completionTokens: 5 };
  };
  const r = await runModelBenchmark({ _invoke: invoke as never });
  expect(r.duels.length).toBeGreaterThanOrEqual(3);
  expect(r.leaderboard.length).toBeGreaterThan(0);
  expect(["anthropic/claude-opus-4.8", "anthropic/claude-sonnet-5"]).toContain(r.leaderboard[0].model);
});

// ---- Phase 2: multi-model boardroom ----
test("every board seat has a preferred brain and they span multiple AI companies", () => {
  for (const seat of BOARD) expect(SEAT_MODELS[seat.role]?.length).toBeGreaterThan(0);
  const families = new Set(Object.values(SEAT_MODELS).flat().map((m) => m.split("/")[0]));
  expect(families.size).toBeGreaterThanOrEqual(3); // anthropic + openai + google (+ z-ai/qwen)
});
