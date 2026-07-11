/** Daily LLM budget guard — the premium-mode half of "never burn credits
 *  accidentally". Over the cap, paid hops are SKIPPED pre-call (estimates) and the
 *  chain degrades to free models; free mode never reaches a paid hop at all.
 *  Network-free: every call goes through the _invoke seam. */

import { test, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { db } from "@/lib/db";
import { callLlmRouted, dailyBudgetUsd, todaySpendUsd, usageSummary, estimateCost } from "@/lib/genesis/agent-runtime/router";
import { seedRegistry } from "@/lib/genesis/agent-runtime/model-registry";
import type { LlmOptions } from "@/lib/genesis/agent-runtime/types";

const KEYS = ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "OLLAMA_HOST", "ZAI_API_KEY", "PREMIUM_MODE", "GENESIS_DAILY_BUDGET_USD"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];
function setEnv(vals: Partial<Record<(typeof KEYS)[number], string>>) { for (const k of KEYS) delete process.env[k]; for (const [k, v] of Object.entries(vals)) process.env[k] = v; }
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
// fake-token usage rows must never survive into the committed db's REAL spend ledger
afterAll(async () => { await db.llmUsage.deleteMany({ where: { agent: { startsWith: "BUDGETTEST" } } }); });

beforeEach(async () => {
  await seedRegistry();
  await db.modelRegistry.updateMany({ data: { reliability: 50, avgLatencyMs: 0, measuredWins: 0, measuredLosses: 0, active: true } });
  await db.llmUsage.deleteMany({ where: { agent: { startsWith: "BUDGETTEST" } } });
});

/** seam that accepts EVERY model and records which ones were actually invoked */
function seam(seen: string[]) {
  return async (_p: unknown, opts: LlmOptions) => { seen.push(opts.model!); return { text: "ok", promptTokens: 100, completionTokens: 50 }; };
}

test("defaults: unset → $25/day; 'off' → uncapped; 0 → zero budget; garbage → default", () => {
  setEnv({});
  expect(dailyBudgetUsd()).toBe(25);
  process.env.GENESIS_DAILY_BUDGET_USD = "off";
  expect(dailyBudgetUsd()).toBe(Infinity);
  process.env.GENESIS_DAILY_BUDGET_USD = "0";
  expect(dailyBudgetUsd()).toBe(0);
  process.env.GENESIS_DAILY_BUDGET_USD = "not-a-number";
  expect(dailyBudgetUsd()).toBe(25);
});

test("over budget: paid hops are skipped pre-call — ZERO paid invocations, free hops still run", async () => {
  const baseline = await todaySpendUsd();
  setEnv({ OPENROUTER_API_KEY: "sk-test", PREMIUM_MODE: "true", GENESIS_DAILY_BUDGET_USD: String(baseline + 0.0001) });
  const seen: string[] = [];
  const r = await callLlmRouted({ system: "s", user: "u" }, { agent: "BUDGETTEST_over", _invoke: seam(seen) as never });
  for (const m of seen) expect(estimateCost(m, 1e6, 1e6)).toBe(0); // nothing paid was ever attempted
  if (r.ok) expect(estimateCost(r.model!, 1e6, 1e6)).toBe(0); // rescued by a free hop
  else expect(r.error).toContain("SKIPPED_BUDGET"); // or honestly refused, never silently burned
});

test("under budget: the premium primary runs (budget does not cripple paid routing)", async () => {
  const baseline = await todaySpendUsd();
  setEnv({ OPENROUTER_API_KEY: "sk-test", PREMIUM_MODE: "true", GENESIS_DAILY_BUDGET_USD: String(baseline + 1000) });
  const seen: string[] = [];
  const r = await callLlmRouted({ system: "s", user: "u" }, { agent: "BUDGETTEST_under", _invoke: seam(seen) as never });
  expect(r.ok).toBe(true);
  expect(r.model).toBe("anthropic/claude-opus-4.8"); // REASONING primary, paid, allowed
});

test("budget 0: every paid hop blocked even with zero spend", async () => {
  setEnv({ OPENROUTER_API_KEY: "sk-test", PREMIUM_MODE: "true", GENESIS_DAILY_BUDGET_USD: "0" });
  const seen: string[] = [];
  await callLlmRouted({ system: "s", user: "u" }, { agent: "BUDGETTEST_zero", _invoke: seam(seen) as never });
  for (const m of seen) expect(estimateCost(m, 1e6, 1e6)).toBe(0);
});

test("'off' uncaps: paid primary runs regardless of spend", async () => {
  setEnv({ OPENROUTER_API_KEY: "sk-test", PREMIUM_MODE: "true", GENESIS_DAILY_BUDGET_USD: "off" });
  const seen: string[] = [];
  const r = await callLlmRouted({ system: "s", user: "u" }, { agent: "BUDGETTEST_off", _invoke: seam(seen) as never });
  expect(r.ok).toBe(true);
  expect(r.model).toBe("anthropic/claude-opus-4.8");
});

test("free mode ignores the budget env entirely (free models are always available)", async () => {
  setEnv({ OPENROUTER_API_KEY: "sk-test", GENESIS_DAILY_BUDGET_USD: "0" }); // no PREMIUM_MODE
  const seen: string[] = [];
  const r = await callLlmRouted({ system: "s", user: "u" }, { agent: "BUDGETTEST_free", _invoke: seam(seen) as never });
  expect(r.ok).toBe(true);
  expect(estimateCost(r.model!, 1e6, 1e6)).toBe(0);
});

test("usageSummary exposes the budget block (cap, spend, remaining, enforced)", async () => {
  setEnv({ OPENROUTER_API_KEY: "sk-test", PREMIUM_MODE: "true", GENESIS_DAILY_BUDGET_USD: "50" });
  const s = await usageSummary(24);
  expect(s.budget.capUsd).toBe(50);
  expect(typeof s.budget.todaySpendUsd).toBe("number");
  expect(s.budget.remainingUsd).toBeLessThanOrEqual(50);
  expect(s.budget.enforced).toBe(true);
  process.env.GENESIS_DAILY_BUDGET_USD = "off";
  const s2 = await usageSummary(24);
  expect(s2.budget.capUsd).toBeNull();
  expect(s2.budget.remainingUsd).toBeNull();
});
