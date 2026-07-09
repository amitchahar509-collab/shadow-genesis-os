/** V8 G9 — Reality Feedback Brain tests: ingest → react (tasks/metrics/memory) and close the acquisition boundary. */

import { test, expect, beforeEach } from "bun:test";
import { db } from "@/lib/db";
import { ingestSignal, processPending } from "@/lib/genesis/agent-runtime/reality-feedback";

const PK = "co-testrf";

beforeEach(async () => {
  await db.realitySignal.deleteMany({ where: { productKey: { startsWith: "co-testrf" } } });
  await db.genesisTask.deleteMany({ where: { title: { contains: "TESTRF" } } });
  await db.growthExperiment.deleteMany({ where: { subject: { startsWith: "TESTRF" } } });
  await db.memoryEntry.deleteMany({ where: { source: { startsWith: "REALITY:" }, content: { contains: "TESTRF" } } });
});

test("ingest ERROR → creates a CRITICAL QUALITY task and marks the signal acted-on", async () => {
  const r = await ingestSignal({ kind: "ERROR", productKey: PK, source: "sentry", detail: "TESTRF 500 on /checkout" });
  expect(r.signalId).toMatch(/^RS-\d{6}$/);
  expect(r.impact).toBe("NEGATIVE");
  expect(r.generated.some((g) => g.kind === "TASK")).toBe(true);
  const taskId = r.generated.find((g) => g.kind === "TASK")!.id;
  const task = await db.genesisTask.findUnique({ where: { taskId } });
  expect(task!.ownerAgent).toBe("QUALITY");
  expect(task!.priority).toBe("CRITICAL");
  const sig = await db.realitySignal.findUnique({ where: { signalId: r.signalId } });
  expect(sig!.actedOn).toBe(true);
  expect(sig!.processedAt).not.toBeNull();
});

test("ingest negative FEEDBACK → ENGINEERING task; positive feedback → no task", async () => {
  const neg = await ingestSignal({ kind: "FEEDBACK", productKey: PK, source: "survey", detail: "TESTRF too slow", sentiment: -0.8 });
  expect(neg.generated.some((g) => g.kind === "TASK")).toBe(true);
  const pos = await ingestSignal({ kind: "FEEDBACK", productKey: PK, source: "survey", detail: "TESTRF love it", sentiment: 0.9 });
  expect(pos.impact).toBe("POSITIVE");
  expect(pos.generated.length).toBe(0); // praise doesn't spawn a fix
});

test("ingest FEATURE_REQUEST → GROWTH backlog task", async () => {
  const r = await ingestSignal({ kind: "FEATURE_REQUEST", productKey: PK, source: "in-app", detail: "TESTRF add dark mode" });
  const task = await db.genesisTask.findUnique({ where: { taskId: r.generated[0].id } });
  expect(task!.ownerAgent).toBe("GROWTH");
});

test("ingest USAGE/RETENTION → real GrowthMetric rows (legitimately REAL telemetry)", async () => {
  const u = await ingestSignal({ kind: "USAGE", productKey: PK, source: "telemetry", detail: "TESTRF dau", payload: { value: 320, unit: "users", period: "daily" } });
  const metricId = u.generated.find((g) => g.kind === "METRIC")!.id;
  const metric = await db.growthMetric.findUnique({ where: { id: metricId } });
  expect(metric!.metric).toBe("usage");
  expect(metric!.value).toBe(320);
});

test("every signal is recorded to memory (Products → Genesis Memory)", async () => {
  const r = await ingestSignal({ kind: "USAGE", productKey: PK, source: "telemetry", detail: "TESTRF memtest", payload: { value: 5 } });
  const mem = await db.memoryEntry.findFirst({ where: { source: `REALITY:${r.signalId}` } });
  expect(mem).not.toBeNull();
  expect(mem!.type).toBe("EPISODIC");
});

test("CONVERSION closes the acquisition boundary: AWAITING_EXECUTION channel → LEARNED with dataSource REAL", async () => {
  const subject = "TESTRF-OPP";
  // A channel experiment approved and awaiting real execution (as the Acquisition Engine leaves it).
  await db.growthExperiment.create({ data: { experimentId: "EXP-TESTRF01", subject, kind: "CHANNEL", name: "TESTRF channel", metric: "real_conversions", hypothesis: "h", status: "AWAITING_EXECUTION", dataSource: "NONE", result: "{}" } });
  const r = await ingestSignal({ kind: "CONVERSION", productKey: PK, source: "utm-tracker", detail: "TESTRF community post results", subject, payload: { conversions: 24, visitors: 800 } });
  expect(r.generated.some((g) => g.kind === "EXPERIMENT")).toBe(true);
  const exp = await db.growthExperiment.findUnique({ where: { experimentId: "EXP-TESTRF01" } });
  expect(exp!.status).toBe("LEARNED");
  expect(exp!.dataSource).toBe("REAL"); // the honesty boundary is now crossed with genuine data
  expect(exp!.learning).toContain("[REAL]");
  expect(exp!.learning).toContain("3%"); // 24/800 = 3.0%
  await db.growthExperiment.deleteMany({ where: { experimentId: "EXP-TESTRF01" } });
});

test("processPending re-processes an unacted signal", async () => {
  // Simulate a signal that was stored but never processed (e.g. crash mid-ingest).
  await db.realitySignal.create({ data: { signalId: "RS-TESTRF9", kind: "ERROR", type: "FAILURE", source: "s", productKey: PK, payload: JSON.stringify({ detail: "TESTRF orphan error" }), actedOn: false } });
  const out = await processPending();
  expect(out.some((r) => r.signalId === "RS-TESTRF9")).toBe(true);
  const sig = await db.realitySignal.findUnique({ where: { signalId: "RS-TESTRF9" } });
  expect(sig!.actedOn).toBe(true);
  await db.realitySignal.deleteMany({ where: { signalId: "RS-TESTRF9" } });
});
