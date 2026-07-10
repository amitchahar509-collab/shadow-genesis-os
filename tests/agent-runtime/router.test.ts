/** Multi-provider router tests: per-agent routing, provider filtering, fallback chain, cost, usage — network-free. */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { db } from "@/lib/db";
import { capabilityFor, resolveChain, estimateCost, availableProviders, callLlmRouted, routingTable, usageSummary } from "@/lib/genesis/agent-runtime/router";
import type { LlmOptions } from "@/lib/genesis/agent-runtime/types";

const KEYS = ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "ZAI_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];
function setKeys(...on: string[]) { for (const k of KEYS) delete process.env[k]; for (const k of on) process.env[k] = "sk-test"; }
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
beforeEach(async () => {
  await db.llmUsage.deleteMany({ where: { agent: { startsWith: "ROUTERTEST" } } });
  // dynamic routing reads MEASURED registry state — reset to neutral so ranking
  // is deterministic (tier + tie-break only) regardless of prior test drift
  await db.modelRegistry.updateMany({ data: { reliability: 50, avgLatencyMs: 0, measuredWins: 0, measuredLosses: 0 } });
});

// fake invoke seam: succeed only for models in `okModels`, else throw
function fakeInvoke(okModels: string[], tokens = { p: 100, c: 50 }) {
  return async (_provider: "anthropic" | "openrouter" | "zai", opts: LlmOptions) => {
    if (okModels.includes(opts.model!)) return { text: `reply from ${opts.model}`, promptTokens: tokens.p, completionTokens: tokens.c };
    throw new Error(`HTTP_401 for ${opts.model}`);
  };
}

test("per-agent capability routing matches the directive", () => {
  expect(capabilityFor("CEO")).toBe("REASONING");
  expect(capabilityFor("BOARDROOM")).toBe("REASONING");
  expect(capabilityFor("ENGINEERING")).toBe("CODING");
  expect(capabilityFor("RESEARCH")).toBe("LONG_CONTEXT");
  expect(capabilityFor("MEMORY")).toBe("CHEAP");
  expect(capabilityFor("VENTURE")).toBe("DEFAULT");
});

test("resolveChain filters to configured providers and preserves order", () => {
  setKeys("ANTHROPIC_API_KEY"); // anthropic only
  const ceo = resolveChain("CEO");
  expect(ceo.length).toBeGreaterThan(0);
  expect(ceo.every((h) => h.provider === "anthropic")).toBe(true);
  expect(ceo[0].model).toBe("claude-opus-4-8"); // strongest reasoning model, primary

  setKeys("OPENROUTER_API_KEY"); // openrouter only
  const eng = resolveChain("ENGINEERING");
  expect(eng.every((h) => h.provider === "openrouter")).toBe(true);

  setKeys(); // none
  expect(resolveChain("CEO").length).toBe(0);
});

test("availableProviders reflects the configured keys", () => {
  setKeys("ANTHROPIC_API_KEY", "OPENROUTER_API_KEY");
  const a = availableProviders();
  expect(a.has("anthropic")).toBe(true);
  expect(a.has("openrouter")).toBe(true);
  expect(a.has("zai")).toBe(false);
});

test("estimateCost = real tokens × published per-1M rates", () => {
  // opus: $15/1M in, $75/1M out → 1000 in + 1000 out = 0.015 + 0.075 = 0.09
  expect(estimateCost("claude-opus-4-8", 1000, 1000)).toBeCloseTo(0.09, 5);
  // cheap model far lower
  expect(estimateCost("openai/gpt-4o-mini", 1000, 1000)).toBeLessThan(estimateCost("claude-opus-4-8", 1000, 1000));
});

test("no providers → honest NO_PROVIDER failure (agents fall back to heuristic)", async () => {
  setKeys();
  const r = await callLlmRouted({ system: "s", user: "u" }, { agent: "ROUTERTEST_none" });
  expect(r.ok).toBe(false);
  expect(r.error).toContain("NO_PROVIDER");
  expect(r.costUsd).toBe(0);
});

test("primary model succeeds → records real tokens + estimated cost, fallbackDepth 0", async () => {
  setKeys("ANTHROPIC_API_KEY");
  const c = await callLlmRouted({ system: "s", user: "u" }, { agent: "CEO", executionId: "ROUTERTEST-ex", _invoke: fakeInvoke(["claude-opus-4-8"]) as never });
  expect(c.ok).toBe(true);
  expect(c.provider).toBe("anthropic");
  expect(c.model).toBe("claude-opus-4-8"); // registry-ranked REASONING primary (anthropic-only)
  expect(c.fallbackDepth).toBe(0);
  expect(c.tokensUsed).toBe(150);
  expect(c.costUsd).toBeGreaterThan(0);
  expect(c.expectedCostUsd).toBeGreaterThan(0); // pre-call cost intelligence recorded
  const row = await db.llmUsage.findFirst({ where: { agent: "CEO", executionId: "ROUTERTEST-ex" } });
  expect(row!.totalTokens).toBe(150);
  expect(row!.ok).toBe(true);
  await db.llmUsage.deleteMany({ where: { agent: "CEO", executionId: "ROUTERTEST-ex" } });
});

test("fallback chain: primary fails → next hop succeeds (fallbackDepth > 0)", async () => {
  setKeys("ANTHROPIC_API_KEY", "OPENROUTER_API_KEY");
  // CODING chain: [openrouter anthropic/claude-sonnet-5, anthropic claude-sonnet-5, …].
  // Fail the openrouter primary; succeed the direct-anthropic 2nd hop.
  const r = await callLlmRouted({ system: "s", user: "u" }, { agent: "ENGINEERING", _invoke: fakeInvoke(["claude-sonnet-5"]) as never });
  expect(r.ok).toBe(true);
  expect(r.provider).toBe("anthropic");
  expect(r.model).toBe("claude-sonnet-5");
  expect(r.fallbackDepth).toBe(1); // used the 2nd hop
});

test("whole chain fails → error records a failed usage row (0 tokens)", async () => {
  setKeys("ANTHROPIC_API_KEY", "OPENROUTER_API_KEY");
  const r = await callLlmRouted({ system: "s", user: "u" }, { agent: "ROUTERTEST_fail", executionId: "ROUTERTEST-f", _invoke: fakeInvoke([]) as never });
  expect(r.ok).toBe(false);
  expect(r.error).toContain("failed");
  const row = await db.llmUsage.findFirst({ where: { executionId: "ROUTERTEST-f" } });
  expect(row!.ok).toBe(false);
  expect(row!.totalTokens).toBe(0);
  await db.llmUsage.deleteMany({ where: { executionId: "ROUTERTEST-f" } });
});

test("routingTable exposes per-agent chains with availability flags", () => {
  setKeys("ANTHROPIC_API_KEY");
  const table = routingTable();
  const ceo = table.find((t) => t.agent === "CEO")!;
  expect(ceo.capability).toBe("REASONING");
  expect(ceo.chain.some((h) => h.available)).toBe(true); // the anthropic-direct hop is available
  expect(ceo.chain.some((h) => h.provider === "openrouter" && !h.available)).toBe(true); // openrouter hops flagged unavailable
});

test("usageSummary aggregates real tokens + estimated cost by provider/model/agent", async () => {
  setKeys("ANTHROPIC_API_KEY");
  await callLlmRouted({ system: "s", user: "u" }, { agent: "CEO", executionId: "ROUTERTEST-sum", _invoke: fakeInvoke(["claude-opus-4-8"], { p: 200, c: 100 }) as never });
  const sum = await usageSummary(24);
  expect(sum.totalTokens).toBeGreaterThanOrEqual(300);
  expect(sum.totalCostUsd).toBeGreaterThan(0);
  expect(sum.byProvider.anthropic).toBeDefined();
  expect(sum.costNote).toContain("ESTIMATE");
  await db.llmUsage.deleteMany({ where: { executionId: "ROUTERTEST-sum" } });
});
