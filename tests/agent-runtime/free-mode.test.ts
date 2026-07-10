/** FREE_GENESIS_MODE tests — $0 models by default, premium only behind PREMIUM_MODE=true.
 *  The core guarantee: credits are NEVER burned accidentally. Network-free. */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { db } from "@/lib/db";
import { seedRegistry, rankModels, emergencyModel, premiumMode, FREE_SEED, syncWithCatalog } from "@/lib/genesis/agent-runtime/model-registry";
import { resolveChain, resolveChainDynamic, callLlmRouted } from "@/lib/genesis/agent-runtime/router";
import { SEAT_MODELS_FREE, BOARD } from "@/lib/genesis/agent-runtime/boardroom";
import type { LlmOptions } from "@/lib/genesis/agent-runtime/types";

const KEYS = ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "ZAI_API_KEY", "PREMIUM_MODE"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];
/** free-mode setup: keys present, PREMIUM_MODE ABSENT (the default state). */
function freeMode(...keys: string[]) { for (const k of KEYS) delete process.env[k]; for (const k of keys) process.env[k] = "sk-test"; }
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
beforeEach(async () => {
  await seedRegistry();
  await db.modelRegistry.updateMany({ data: { reliability: 50, avgLatencyMs: 0, measuredWins: 0, measuredLosses: 0, active: true } });
  await db.llmUsage.deleteMany({ where: { agent: { startsWith: "FREETEST" } } });
});

test("premiumMode defaults to OFF — free is the default state", () => {
  freeMode("OPENROUTER_API_KEY");
  expect(premiumMode()).toBe(false);
  process.env.PREMIUM_MODE = "true";
  expect(premiumMode()).toBe(true);
});

test("free seeds cover the directive: qwen coder + reasoning + llama (verified $0 slugs)", async () => {
  const free = await db.modelRegistry.findMany({ where: { free: true } });
  const ids = free.map((f) => f.modelId);
  expect(ids).toContain("qwen/qwen3-coder:free");
  expect(ids).toContain("nousresearch/hermes-3-llama-3.1-405b:free"); // reasoning
  expect(ids).toContain("meta-llama/llama-3.3-70b-instruct:free");
  for (const f of FREE_SEED) expect(f.promptPrice + f.completionPrice).toBe(0);
});

test("free mode: every chain for every capability contains ONLY $0 models", async () => {
  freeMode("OPENROUTER_API_KEY");
  for (const agent of ["CEO", "BOARDROOM", "ENGINEERING", "RESEARCH", "MEMORY", "VENTURE"]) {
    const chain = await resolveChainDynamic(agent);
    expect(chain.length).toBeGreaterThan(0);
    for (const hop of chain) expect(hop.model.endsWith(":free")).toBe(true);
  }
  // static baseline too
  for (const agent of ["CEO", "ENGINEERING", "MEMORY"]) {
    for (const hop of resolveChain(agent)) expect(hop.model.endsWith(":free")).toBe(true);
  }
});

test("free mode: rankModels and emergencyModel exclude paid models", async () => {
  freeMode("OPENROUTER_API_KEY");
  const ranked = await rankModels("REASONING", { providers: new Set(["openrouter"]) });
  expect(ranked.length).toBeGreaterThan(0);
  for (const m of ranked) expect(m.promptPrice + m.completionPrice).toBe(0);
  const em = await emergencyModel(new Set(["openrouter"]));
  expect(em!.modelId.endsWith(":free")).toBe(true);
});

test("PREMIUM_MODE=true restores frontier routing (opus primary for CEO)", async () => {
  freeMode("OPENROUTER_API_KEY");
  process.env.PREMIUM_MODE = "true";
  const chain = await resolveChainDynamic("CEO");
  expect(chain[0].model).toBe("anthropic/claude-opus-4.8");
});

test("credit-burn guard: even an injected paid hop is refused in free mode", async () => {
  freeMode("OPENROUTER_API_KEY");
  // preferModels with a PAID model: must not resolve in free mode
  const chain = await resolveChainDynamic("CEO", "NORMAL", ["anthropic/claude-opus-4.8"]);
  expect(chain.some((h) => h.model === "anthropic/claude-opus-4.8")).toBe(false);
  // and the hop-level guard: an invoke seam that would accept ANY model only ever sees free ones
  const seen: string[] = [];
  const invoke = async (_p: string, opts: LlmOptions) => { seen.push(opts.model!); return { text: "ok", promptTokens: 5, completionTokens: 5 }; };
  const r = await callLlmRouted({ system: "s", user: "u" }, { agent: "FREETEST_guard", _invoke: invoke as never });
  expect(r.ok).toBe(true);
  for (const m of seen) expect(m.endsWith(":free")).toBe(true);
});

test("free mode board seats: every seat has a $0 brain and the debate spans ≥2 model families", () => {
  for (const seat of BOARD) {
    const prefs = SEAT_MODELS_FREE[seat.role];
    expect(prefs?.length).toBeGreaterThan(0);
    for (const m of prefs) expect(m.endsWith(":free")).toBe(true);
  }
  const families = new Set(Object.values(SEAT_MODELS_FREE).flat().map((m) => m.split("/")[0]));
  expect(families.size).toBeGreaterThanOrEqual(2); // qwen + meta-llama + nousresearch
});

test("dynamic free discovery: sync auto-registers new :free models from families of interest", async () => {
  await db.modelRegistry.deleteMany({ where: { modelId: "deepseek/deepseek-r1:free" } });
  const fake = async () => [
    ...FREE_SEED.map((f) => ({ id: f.modelId, context_length: f.contextLength, pricing: { prompt: "0", completion: "0" } })),
    { id: "deepseek/deepseek-r1:free", context_length: 128000, pricing: { prompt: "0", completion: "0" } }, // new free reasoning model appears
  ];
  const r = await syncWithCatalog(fake);
  expect(r.discovered).toBeGreaterThanOrEqual(1);
  const row = await db.modelRegistry.findUnique({ where: { modelId: "deepseek/deepseek-r1:free" } });
  expect(row!.free).toBe(true);
  expect(row!.family).toBe("DEEPSEEK");
  await db.modelRegistry.deleteMany({ where: { modelId: "deepseek/deepseek-r1:free" } });
});
