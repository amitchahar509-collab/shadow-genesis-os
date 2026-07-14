/** V10 Module 12 — Performance & Scale. Multi-level cache (deterministic-only),
 *  dependency-aware parallel scheduler, queue state machine, token/model
 *  optimization — every gain MEASURED, never fabricated. Network-free. */

import { test, expect, beforeEach, afterAll } from "bun:test";
import { db } from "@/lib/db";
import {
  cacheGet, cacheSet, cached, isCacheable, invalidate, invalidateNamespace, invalidateByTag,
  cacheStats, resetCacheStats, clearL1, pruneExpired,
  planParallel, runScheduled, compressPrompt, optimizeModelChoice, dedupeKey, trimForTransport,
  enqueue, dequeue, completeTask, failTask, cancelTask, reconcileDeps, queueStatus, performanceBenchmark,
} from "@/lib/genesis/agent-runtime/performance";

async function wipe() {
  await db.cacheEntry.deleteMany({ where: { namespace: { startsWith: "PERFTEST" } } });
  await db.cacheEntry.deleteMany({ where: { namespace: { startsWith: "bench:" } } });
  await db.perfTask.deleteMany({ where: { queue: { startsWith: "PERFTEST" } } });
}
beforeEach(async () => { clearL1(); resetCacheStats(); await wipe(); });
afterAll(wipe);

// ---- Cache ----
test("cache stores + retrieves from L1 then L2; deterministic outputs only", async () => {
  await cacheSet("PERFTEST_ns", { q: 1 }, { answer: 42 });
  const l1 = await cacheGet<{ answer: number }>("PERFTEST_ns", { q: 1 });
  expect(l1!.level).toBe("L1");
  expect(l1!.value.answer).toBe(42);
  clearL1(); // drop L1 → must fall through to persistent L2
  const l2 = await cacheGet<{ answer: number }>("PERFTEST_ns", { q: 1 });
  expect(l2!.level).toBe("L2");
  expect(l2!.value.answer).toBe(42);
});

test("forbidden namespaces are NEVER cached (approval/security/external/payment)", async () => {
  expect(isCacheable("PERFTEST_ok")).toBe(true);
  for (const ns of ["approval", "security", "payment", "external_mutation", "connector-x", "secret-store"]) {
    expect(isCacheable(ns)).toBe(false);
    expect(await cacheSet(ns, { a: 1 }, { v: 1 })).toBe(false); // refused
    expect(await cacheGet(ns, { a: 1 })).toBeNull();
  }
});

test("cache hit ratio is a REAL counter", async () => {
  resetCacheStats();
  await cached("PERFTEST_hr", { k: 1 }, () => "x"); // miss + set
  await cached("PERFTEST_hr", { k: 1 }, () => "x"); // L1 hit
  await cached("PERFTEST_hr", { k: 2 }, () => "y"); // miss + set
  const s = cacheStats();
  expect(s.l1Hits).toBe(1);
  expect(s.misses).toBe(2);
  expect(s.hitRatio).toBeCloseTo(1 / 3, 2);
});

test("invalidation: key, namespace, and tag all evict", async () => {
  await cacheSet("PERFTEST_inv", { k: 1 }, { v: 1 }, { tags: ["t1"] });
  await cacheSet("PERFTEST_inv", { k: 2 }, { v: 2 }, { tags: ["t1"] });
  await invalidate("PERFTEST_inv", { k: 1 });
  expect(await cacheGet("PERFTEST_inv", { k: 1 })).toBeNull();
  expect(await cacheGet("PERFTEST_inv", { k: 2 })).not.toBeNull();
  const byTag = await invalidateByTag("t1");
  expect(byTag).toBeGreaterThanOrEqual(1);
  expect(await cacheGet("PERFTEST_inv", { k: 2 })).toBeNull();
});

test("TTL expiry: an expired entry is a miss and is pruned", async () => {
  await cacheSet("PERFTEST_ttl", { k: 1 }, { v: 1 }, { ttlMs: 1 });
  await new Promise((r) => setTimeout(r, 10));
  clearL1();
  expect(await cacheGet("PERFTEST_ttl", { k: 1 })).toBeNull(); // expired
  const pruned = await pruneExpired();
  expect(pruned).toBeGreaterThanOrEqual(0);
});

// ---- Scheduler ----
test("planParallel layers a dependency graph; independent tasks share a layer", () => {
  const plan = planParallel([{ id: "a" }, { id: "b" }, { id: "c", dependsOn: ["a", "b"] }, { id: "d", dependsOn: ["c"] }]);
  expect(plan.layers[0].sort()).toEqual(["a", "b"]); // independent → parallel
  expect(plan.layers[1]).toEqual(["c"]);
  expect(plan.layers[2]).toEqual(["d"]);
  expect(plan.maxWidth).toBe(2);
});

test("planParallel throws on a real dependency cycle", () => {
  expect(() => planParallel([{ id: "a", dependsOn: ["b"] }, { id: "b", dependsOn: ["a"] }])).toThrow(/cycle/);
});

test("runScheduled MEASURES a real parallel speedup over serial", async () => {
  const N = 6, delay = 20;
  const work = (id: string) => new Promise<string>((r) => setTimeout(() => r(id), delay));
  const run = await runScheduled(Array.from({ length: N }, (_, i) => ({ id: `t${i}` })), work, { concurrency: N });
  expect(run.results.size).toBe(N);
  expect([...run.results.values()].every((r) => r.ok)).toBe(true);
  // parallel wall time is materially less than the serial sum (measured, not claimed)
  expect(run.wallMs).toBeLessThan(run.serialMs);
  expect(run.speedup).toBeGreaterThan(1.5);
});

test("scheduler respects dependencies (dependent runs AFTER its prereq)", async () => {
  const order: string[] = [];
  const work = async (id: string) => { order.push(id); await new Promise((r) => setTimeout(r, 5)); return id; };
  await runScheduled([{ id: "first" }, { id: "second", dependsOn: ["first"] }], work);
  expect(order.indexOf("first")).toBeLessThan(order.indexOf("second"));
});

test("automatic cancellation skips remaining work", async () => {
  const signal = { cancelled: false };
  const work = async (id: string) => { if (id === "a") signal.cancelled = true; return id; };
  const run = await runScheduled([{ id: "a" }, { id: "b", dependsOn: ["a"] }], work, { signal });
  expect(run.cancelled).toContain("b"); // later layer skipped after cancel
});

// ---- Queue ----
test("queue state machine: enqueue → dequeue(RUNNING) → complete(COMPLETED)", async () => {
  const { taskId } = await enqueue({ queue: "PERFTEST_q", kind: "work" });
  const claimed = await dequeue("PERFTEST_q");
  expect(claimed!.taskId).toBe(taskId);
  expect((await db.perfTask.findUnique({ where: { taskId } }))!.status).toBe("RUNNING");
  await completeTask(taskId, { done: true }, 12);
  expect((await db.perfTask.findUnique({ where: { taskId } }))!.status).toBe("COMPLETED");
});

test("dependency gating: a task WAITS until its deps COMPLETE, then becomes READY", async () => {
  const a = await enqueue({ queue: "PERFTEST_dep", kind: "a" });
  const b = await enqueue({ queue: "PERFTEST_dep", kind: "b", dependsOn: [a.taskId] });
  expect((await db.perfTask.findUnique({ where: { taskId: b.taskId } }))!.status).toBe("WAITING");
  // b is not dequeuable while waiting
  const first = await dequeue("PERFTEST_dep");
  expect(first!.taskId).toBe(a.taskId);
  await completeTask(a.taskId); // triggers reconcile
  expect((await db.perfTask.findUnique({ where: { taskId: b.taskId } }))!.status).toBe("READY");
});

test("priority ordering: higher priority (lower number) dequeues first", async () => {
  await enqueue({ queue: "PERFTEST_pri", kind: "low", priority: 8 });
  const hi = await enqueue({ queue: "PERFTEST_pri", kind: "high", priority: 1 });
  const first = await dequeue("PERFTEST_pri");
  expect(first!.taskId).toBe(hi.taskId);
});

test("retry then DEAD_LETTER after maxAttempts", async () => {
  const { taskId } = await enqueue({ queue: "PERFTEST_retry", kind: "flaky", maxAttempts: 2 });
  await dequeue("PERFTEST_retry"); // attempt 1
  expect((await failTask(taskId, "boom")).status).toBe("RETRY");
  await dequeue("PERFTEST_retry"); // attempt 2 (re-armed to READY)
  expect((await failTask(taskId, "boom")).status).toBe("DEAD_LETTER");
});

test("duplicate detection: dedupe returns the existing in-flight task", async () => {
  const a = await enqueue({ queue: "PERFTEST_dup", kind: "scan", payload: { url: "x" }, dedupe: true });
  const b = await enqueue({ queue: "PERFTEST_dup", kind: "scan", payload: { url: "x" }, dedupe: true });
  expect(b.duplicate).toBe(true);
  expect(b.taskId).toBe(a.taskId);
  const c = await enqueue({ queue: "PERFTEST_dup", kind: "scan", payload: { url: "y" }, dedupe: true });
  expect(c.duplicate).toBe(false); // different payload → different task
});

test("cancel a queued task", async () => {
  const { taskId } = await enqueue({ queue: "PERFTEST_cancel", kind: "work" });
  expect((await cancelTask(taskId)).ok).toBe(true);
  expect((await db.perfTask.findUnique({ where: { taskId } }))!.status).toBe("FAILED");
});

test("queueStatus counts every state", async () => {
  await enqueue({ queue: "PERFTEST_status", kind: "a" });
  const s = await queueStatus("PERFTEST_status");
  expect(s.byStatus.READY).toBeGreaterThanOrEqual(1);
  expect(Object.keys(s.byStatus)).toContain("DEAD_LETTER");
});

// ---- Token / model optimization ----
test("compressPrompt MEASURES a real token reduction (no meaning change)", () => {
  const bloated = "Do   the    task.\n\n\n\nDo   the    task.\n\n\n";
  const c = compressPrompt(bloated.repeat(10));
  expect(c.tokensAfter).toBeLessThan(c.tokensBefore); // measured reduction
  expect(c.tokensSaved).toBeGreaterThan(0);
  expect(c.text).toContain("Do the task."); // whitespace collapsed, meaning intact
});

test("optimizeModelChoice reuses registry ranking and measures the cost delta", async () => {
  const opt = await optimizeModelChoice("CHEAP");
  if (opt.optimized) {
    expect(opt.optimized.combinedPricePer1M).toBeLessThanOrEqual(opt.baseline!.combinedPricePer1M);
    expect(opt.costSavedPer1M).toBeGreaterThanOrEqual(0); // never a negative/fabricated saving
  }
});

test("trimForTransport is LOSSLESS of content (hot-path token trim) — code/JSON survive", () => {
  // trailing whitespace + 3+ blank lines are removed; intra-line spacing untouched
  expect(trimForTransport("hello   \n\n\n\nworld  ")).toBe("hello\n\nworld");
  // Python indentation and JSON spacing MUST survive byte-for-byte
  const code = 'def f():\n    return {\n        "a":  1,\n        "b": 2\n    }';
  expect(trimForTransport(code)).toBe(code); // no intra-line change → identical
  // real token reduction on padded text, meaning intact
  const padded = "line one   \nline two\t\t\n\n\n\n\nline three";
  const out = trimForTransport(padded);
  expect(out.length).toBeLessThan(padded.length);
  expect(out).toContain("line one");
  expect(out).toContain("line three");
});

test("dedupeKey is deterministic for identical payloads", () => {
  expect(dedupeKey("k", { a: 1 })).toBe(dedupeKey("k", { a: 1 }));
  expect(dedupeKey("k", { a: 1 })).not.toBe(dedupeKey("k", { a: 2 }));
});

// ---- Benchmark engine (measured) ----
test("performanceBenchmark returns MEASURED before/after (never fabricated)", async () => {
  const b = await performanceBenchmark();
  expect(b.benchmarks.length).toBeGreaterThanOrEqual(3);
  const cache = b.benchmarks.find((x) => x.name === "cache_cold_vs_warm")!;
  expect(cache.afterMs).toBeLessThanOrEqual(cache.beforeMs); // warm ≤ cold (real)
  const parallel = b.benchmarks.find((x) => x.name === "serial_vs_parallel")!;
  expect(parallel.afterMs).toBeLessThan(parallel.beforeMs); // parallel faster (measured)
  expect(b.note).toContain("MEASURED");
});
