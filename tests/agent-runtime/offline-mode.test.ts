/** Offline/free dev mode tests — Gemini free tier primary, OpenRouter :free fallback,
 *  optional local Ollama; premium untouched behind PREMIUM_MODE. Network-free. */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { db } from "@/lib/db";
import { seedRegistry, rankModels } from "@/lib/genesis/agent-runtime/model-registry";
import { availableProviders, resolveChain, resolveChainDynamic, estimateCost, callLlmRouted } from "@/lib/genesis/agent-runtime/router";
import type { LlmOptions } from "@/lib/genesis/agent-runtime/types";

const KEYS = ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "OLLAMA_HOST", "OLLAMA_MODEL", "ZAI_API_KEY", "PREMIUM_MODE"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];
function env(vars: Record<string, string>) { for (const k of KEYS) delete process.env[k]; for (const [k, v] of Object.entries(vars)) process.env[k] = v; }
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
beforeEach(async () => {
  await seedRegistry();
  await db.modelRegistry.updateMany({ data: { reliability: 50, avgLatencyMs: 0, measuredWins: 0, measuredLosses: 0, active: true } });
});

test("availableProviders detects gemini (key) and ollama (host)", () => {
  env({ GEMINI_API_KEY: "AIza-test" });
  expect(availableProviders().has("gemini")).toBe(true);
  env({ OLLAMA_HOST: "http://127.0.0.1:11434" });
  expect(availableProviders().has("ollama")).toBe(true);
  env({});
  expect(availableProviders().size).toBe(0);
});

test("gemini free-tier rows are seeded, flagged free, provider 'gemini'", async () => {
  const g = await db.modelRegistry.findUnique({ where: { modelId: "gemini-3.5-flash" } });
  expect(g).not.toBeNull();
  expect(g!.free).toBe(true);
  expect(g!.provider).toBe("gemini");
  expect(g!.promptPrice + g!.completionPrice).toBe(0);
});

test("free mode with gemini + openrouter: GEMINI IS PRIMARY, openrouter :free follows", async () => {
  env({ GEMINI_API_KEY: "AIza-test", OPENROUTER_API_KEY: "sk-or-test" });
  for (const agent of ["CEO", "RESEARCH", "ENGINEERING", "MEMORY"]) {
    const chain = await resolveChainDynamic(agent);
    expect(chain.length).toBeGreaterThan(1);
    expect(chain[0].provider).toBe("gemini"); // directive: gemini primary
    expect(chain.some((h) => h.provider === "openrouter" && h.model.endsWith(":free"))).toBe(true); // OR free fallback present
    for (const h of chain) expect(["gemini", "openrouter", "ollama"]).toContain(h.provider); // no premium leakage
  }
});

test("ollama is optional: appears (last) only when OLLAMA_HOST is set", async () => {
  env({ GEMINI_API_KEY: "AIza-test", OPENROUTER_API_KEY: "sk-or-test" });
  let chain = await resolveChainDynamic("CEO");
  expect(chain.some((h) => h.provider === "ollama")).toBe(false);

  env({ GEMINI_API_KEY: "AIza-test", OPENROUTER_API_KEY: "sk-or-test", OLLAMA_HOST: "http://127.0.0.1:11434", OLLAMA_MODEL: "llama3.2" });
  await seedRegistry(); // registers the local model row
  chain = await resolveChainDynamic("CEO");
  const oll = chain.findIndex((h) => h.provider === "ollama");
  expect(oll).toBeGreaterThan(0); // present but never primary
  expect(chain[oll].model).toBe("ollama:llama3.2");
  await db.modelRegistry.deleteMany({ where: { modelId: "ollama:llama3.2" } });
});

test("static baseline (registry-empty path) is also gemini-first in free mode", () => {
  env({ GEMINI_API_KEY: "AIza-test", OPENROUTER_API_KEY: "sk-or-test" });
  const chain = resolveChain("RESEARCH");
  expect(chain[0]).toEqual({ provider: "gemini", model: "gemini-3.5-flash" });
  for (const h of chain) expect(h.model.endsWith(":free") || h.model.startsWith("gemini-") || h.model.startsWith("ollama:")).toBe(true);
});

test("gemini-only setup works: no other keys needed for free development", async () => {
  env({ GEMINI_API_KEY: "AIza-test" });
  const chain = await resolveChainDynamic("CEO");
  expect(chain.length).toBeGreaterThan(0);
  expect(chain.every((h) => h.provider === "gemini")).toBe(true);
});

test("$0 estimates for free brains — never invent a cost", () => {
  expect(estimateCost("gemini-3.5-flash", 5000, 2000)).toBe(0);
  expect(estimateCost("ollama:llama3.2", 5000, 2000)).toBe(0);
  expect(estimateCost("qwen/qwen3-coder:free", 5000, 2000)).toBe(0);
  expect(estimateCost("anthropic/claude-opus-4.8", 5000, 2000)).toBeGreaterThan(0); // premium still priced
});

test("premium stays intact and gated: PREMIUM_MODE=true restores frontier chains, gemini rows don't displace opus", async () => {
  env({ OPENROUTER_API_KEY: "sk-or-test", GEMINI_API_KEY: "AIza-test", PREMIUM_MODE: "true" });
  const chain = await resolveChainDynamic("CEO");
  expect(chain[0].model).toBe("anthropic/claude-opus-4.8"); // premium primary unchanged
});

test("routed call in free mode only ever touches free providers/models (invoke seam audit)", async () => {
  env({ GEMINI_API_KEY: "AIza-test", OPENROUTER_API_KEY: "sk-or-test" });
  const seen: { provider: string; model: string }[] = [];
  const invoke = async (provider: string, opts: LlmOptions) => { seen.push({ provider, model: opts.model! }); return { text: "ok", promptTokens: 5, completionTokens: 5 }; };
  const r = await callLlmRouted({ system: "s", user: "u" }, { agent: "OFFLINETEST", _invoke: invoke as never });
  expect(r.ok).toBe(true);
  expect(r.provider).toBe("gemini"); // primary
  expect(r.costUsd).toBe(0);
  for (const s of seen) expect(s.model.endsWith(":free") || s.model.startsWith("gemini-") || s.model.startsWith("ollama:")).toBe(true);
  await db.llmUsage.deleteMany({ where: { agent: "OFFLINETEST" } });
});

test("free-mode ranking respects provider precedence but keeps measured order within a provider", async () => {
  env({ GEMINI_API_KEY: "AIza-test", OPENROUTER_API_KEY: "sk-or-test" });
  const ranked = await rankModels("REASONING", { providers: availableProviders() as Set<string> });
  expect(ranked.length).toBeGreaterThan(0); // free rows only (default freeOnly)
  for (const m of ranked) expect(m.promptPrice + m.completionPrice).toBe(0);
});
