/** V8 G12 — Benchmark Arena tests: real scored self-measurement, discrimination, trend. */

import { test, expect, beforeEach } from "bun:test";
import { db } from "@/lib/db";
import { runBenchmark, benchmarkTrend } from "@/lib/genesis/agent-runtime/benchmark";

beforeEach(async () => {
  await db.benchmarkRun.deleteMany({ where: { runId: { startsWith: "BM-" } } });
});

test("intelligence suite: runs real scored tasks and persists a run", async () => {
  const r = await runBenchmark({ suite: "intelligence" });
  expect(r.runId).toMatch(/^BM-\d{6}$/);
  expect(r.totalTasks).toBe(5); // EVIDENCE, VENTURE, CUSTOMER, BOARD, CHAIN
  expect(r.autonomyScore).toBeGreaterThanOrEqual(0);
  expect(r.autonomyScore).toBeLessThanOrEqual(100);
  expect(r.results.length).toBe(5);
  const row = await db.benchmarkRun.findUnique({ where: { runId: r.runId } });
  expect(row).not.toBeNull();
  expect(row!.suite).toBe("intelligence");
}, 60_000);

test("the intelligence stack discriminates correctly (heuristic mode still passes)", async () => {
  const r = await runBenchmark({ suite: "intelligence" });
  // In heuristic mode the stack must still rank strong cases above weak ones and
  // refuse unsupported confidence — that's the whole point of the arena.
  const byId = Object.fromEntries(r.results.map((x) => [x.id, x]));
  expect(byId["evidence-discrimination"].pass).toBe(true);
  expect(byId["venture-discrimination"].pass).toBe(true);
  expect(byId["customer-discrimination"].pass).toBe(true);
  expect(byId["board-decision"].pass).toBe(true);
  expect(byId["decision-chain"].pass).toBe(true);
  expect(r.successRate).toBe(100);
  expect(r.autonomyScore).toBeGreaterThan(70); // correct discriminations score well
}, 60_000);

test("honesty: heuristic mode reports 0 tokens (no fabricated cost)", async () => {
  // deterministically test heuristic mode: clear every provider key for this run
  const provKeys = ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "OLLAMA_HOST", "ZAI_API_KEY"];
  const savedProv = Object.fromEntries(provKeys.map((k) => [k, process.env[k]]));
  for (const k of provKeys) delete process.env[k];
  try {
  const r = await runBenchmark({ suite: "intelligence" });
  expect(r.mode).toBe("HEURISTIC"); // no provider keys
  expect(r.tokensUsed).toBe(0);
  for (const t of r.results) expect(t.ms).toBeGreaterThanOrEqual(0); // real timings
  } finally { for (const k of provKeys) { if (savedProv[k] !== undefined) process.env[k] = savedProv[k]!; } }
}, 60_000);

test("trend: multiple runs accumulate and are returned newest-first", async () => {
  const a = await runBenchmark({ suite: "intelligence" });
  const b = await runBenchmark({ suite: "intelligence" });
  const trend = await benchmarkTrend("intelligence");
  expect(trend.length).toBeGreaterThanOrEqual(2);
  expect(trend[0].runId).toBe(b.runId); // newest first
  expect(trend[1].runId).toBe(a.runId);
  for (const t of trend) expect(typeof t.autonomyScore).toBe("number");
}, 90_000);

test("benchmark leaves no residue (decision-chain cleans up its seeded opportunity)", async () => {
  await runBenchmark({ suite: "intelligence" });
  const leftover = await db.opportunity.findMany({ where: { opportunityId: { startsWith: "OPP-BENCHCHAIN-" } } });
  expect(leftover.length).toBe(0);
  const runs = await db.ventureRun.findMany({ where: { opportunityTitle: "BENCH chain product" } });
  expect(runs.length).toBe(0);
}, 60_000);
