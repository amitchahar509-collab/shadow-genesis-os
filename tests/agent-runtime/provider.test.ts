/** V8 LLM-path tests: provider status, capability matrix, honest degradation, real self-test. */

import { test, expect, afterEach } from "bun:test";
import { getProviderStatus, checkProvider } from "@/lib/genesis/agent-runtime/provider";

const KEYS = ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "OLLAMA_HOST", "ZAI_API_KEY", "GENESIS_LLM_MODEL"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];
function clearKeys() { for (const k of KEYS) delete process.env[k]; }
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

test("no key → DEGRADED, HEURISTIC reasoning, and every LLM-gated gate flagged heuristic", async () => {
  clearKeys();
  const s = await getProviderStatus();
  expect(s.provider).toBe("none");
  expect(s.degraded).toBe(true);
  expect(s.reasoningMode).toBe("HEURISTIC");
  expect(s.llmGated.length).toBeGreaterThan(0);
  expect(s.llmGated.every((g) => g.mode === "HEURISTIC")).toBe(true);
  expect(s.summary).toContain("DEGRADED");
});

test("procedural gates are marked EXACT — never counted as a degradation", async () => {
  clearKeys();
  const s = await getProviderStatus();
  // CUSTOMER simulation / AEGIS / DEMAND / BENCHMARK are deterministic by design.
  const gates = s.procedural.map((g) => g.gate).join(" ");
  expect(gates).toContain("CUSTOMER");
  expect(gates).toContain("AEGIS");
  // procedural gates carry no HEURISTIC/LLM mode (they aren't degraded)
  for (const g of s.procedural) expect("mode" in g).toBe(false);
});

test("setting a key flips status to LLM ACTIVE with the model (status logic only, no call)", async () => {
  clearKeys();
  process.env.ANTHROPIC_API_KEY = "sk-test-not-real";
  const s = await getProviderStatus();
  expect(s.provider).toBe("anthropic");
  expect(s.degraded).toBe(false);
  expect(s.reasoningMode).toBe("LLM");
  expect(s.model).toBe("claude-sonnet-5");
  expect(s.llmGated.every((g) => g.mode === "LLM")).toBe(true);
});

test("GENESIS_LLM_MODEL overrides the default model", async () => {
  clearKeys();
  process.env.ANTHROPIC_API_KEY = "sk-test";
  process.env.GENESIS_LLM_MODEL = "claude-opus-4-8";
  expect((await getProviderStatus()).model).toBe("claude-opus-4-8");
});

test("OpenRouter as sole provider is not degraded and lists in providers[]", async () => {
  clearKeys();
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  const s = await getProviderStatus();
  expect(s.degraded).toBe(false);
  expect(s.providers).toContain("openrouter");
  expect(s.reasoningMode).toBe("LLM");
});

test("checkProvider runs the REAL adapter and reports the honest result", async () => {
  clearKeys();
  const c = await checkProvider();
  // With no provider the real adapter fails honestly — no fabricated OK.
  expect(c.degraded).toBe(true);
  expect(c.ok).toBe(false);
  expect(c.error).toBeTruthy();
  expect(c.latencyMs).toBeGreaterThanOrEqual(0); // real measured latency
}, 20_000);
