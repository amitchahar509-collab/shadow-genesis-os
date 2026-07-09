/** V8 LLM-path tests: provider status, capability matrix, honest degradation, real self-test. */

import { test, expect, afterEach } from "bun:test";
import { getProviderStatus, checkProvider } from "@/lib/genesis/agent-runtime/provider";

const savedAnthropic = process.env.ANTHROPIC_API_KEY;
const savedZai = process.env.ZAI_API_KEY;
afterEach(() => {
  if (savedAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = savedAnthropic;
  if (savedZai === undefined) delete process.env.ZAI_API_KEY; else process.env.ZAI_API_KEY = savedZai;
});

test("no key → DEGRADED, HEURISTIC reasoning, and every LLM-gated gate flagged heuristic", () => {
  delete process.env.ANTHROPIC_API_KEY; delete process.env.ZAI_API_KEY;
  const s = getProviderStatus();
  expect(s.provider).toBe("none");
  expect(s.degraded).toBe(true);
  expect(s.reasoningMode).toBe("HEURISTIC");
  expect(s.llmGated.length).toBeGreaterThan(0);
  expect(s.llmGated.every((g) => g.mode === "HEURISTIC")).toBe(true);
  expect(s.summary).toContain("DEGRADED");
});

test("procedural gates are marked EXACT — never counted as a degradation", () => {
  delete process.env.ANTHROPIC_API_KEY;
  const s = getProviderStatus();
  // CUSTOMER simulation / AEGIS / DEMAND / BENCHMARK are deterministic by design.
  const gates = s.procedural.map((g) => g.gate).join(" ");
  expect(gates).toContain("CUSTOMER");
  expect(gates).toContain("AEGIS");
  // procedural gates carry no HEURISTIC/LLM mode (they aren't degraded)
  for (const g of s.procedural) expect("mode" in g).toBe(false);
});

test("setting a key flips status to LLM ACTIVE with the model (status logic only, no call)", () => {
  process.env.ANTHROPIC_API_KEY = "sk-test-not-real";
  const s = getProviderStatus();
  expect(s.provider).toBe("anthropic");
  expect(s.degraded).toBe(false);
  expect(s.reasoningMode).toBe("LLM");
  expect(s.model).toBe("claude-sonnet-5");
  expect(s.llmGated.every((g) => g.mode === "LLM")).toBe(true);
  delete process.env.ANTHROPIC_API_KEY;
});

test("GENESIS_LLM_MODEL overrides the default model", () => {
  process.env.ANTHROPIC_API_KEY = "sk-test";
  process.env.GENESIS_LLM_MODEL = "claude-opus-4-8";
  expect(getProviderStatus().model).toBe("claude-opus-4-8");
  delete process.env.ANTHROPIC_API_KEY; delete process.env.GENESIS_LLM_MODEL;
});

test("checkProvider runs the REAL adapter and reports the honest result", async () => {
  delete process.env.ANTHROPIC_API_KEY; delete process.env.ZAI_API_KEY;
  const c = await checkProvider();
  // With no provider the real adapter fails honestly — no fabricated OK.
  expect(c.degraded).toBe(true);
  expect(c.ok).toBe(false);
  expect(c.error).toBeTruthy();
  expect(c.latencyMs).toBeGreaterThanOrEqual(0); // real measured latency
}, 20_000);
