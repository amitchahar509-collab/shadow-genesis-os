/** V10 Module 7 — Customer Success Engine. Real product events + support tickets;
 *  metrics are REAL only with real data, else UNKNOWN/empty (never fabricated
 *  users/usage). Recurring real tickets feed the existing reality loop → tasks. */

import { test, expect, beforeEach, afterAll } from "bun:test";
import { db } from "@/lib/db";
import {
  recordProductEvent, createTicket, updateTicket, behaviorAnalytics, dropOffFunnel,
  satisfaction, customerHealth, generateImprovementTasks, customerSuccessOverview,
} from "@/lib/genesis/agent-runtime/customer-success";

const PK = "CSTEST_product";

async function wipe() {
  await db.productEvent.deleteMany({ where: { productKey: PK } });
  const tickets = await db.supportTicket.findMany({ where: { productKey: PK }, select: { taskId: true, signalId: true } });
  await db.supportTicket.deleteMany({ where: { productKey: PK } });
  for (const t of tickets) { if (t.taskId) await db.genesisTask.deleteMany({ where: { taskId: t.taskId } }); if (t.signalId) await db.realitySignal.deleteMany({ where: { signalId: t.signalId } }); }
  await db.realitySignal.deleteMany({ where: { productKey: { in: [PK, "customer-success"] } } });
  await db.genesisTask.deleteMany({ where: { description: { contains: "CSTEST" } } });
}
beforeEach(wipe);
afterAll(wipe);

test("NO product data → analytics are honestly empty, health UNKNOWN (never fabricated)", async () => {
  const beh = await behaviorAnalytics(PK);
  expect(beh.hasData).toBe(false);
  expect(beh.activeUsers).toBe(0);
  expect(beh.note).toContain("honestly empty");
  const h = await customerHealth(PK);
  expect(h.score.label).toBe("UNKNOWN");
  expect(h.status).toBe("UNKNOWN");
});

test("real product events produce real behavior analytics", async () => {
  await recordProductEvent({ productKey: PK, eventType: "SIGNUP", userRef: "u1" });
  await recordProductEvent({ productKey: PK, eventType: "FEATURE_USE", userRef: "u1", feature: "export", sessionId: "s1" });
  await recordProductEvent({ productKey: PK, eventType: "FEATURE_USE", userRef: "u2", feature: "export", sessionId: "s2" });
  const beh = await behaviorAnalytics(PK);
  expect(beh.hasData).toBe(true);
  expect(beh.activeUsers).toBe(2);
  expect(beh.topFeatures[0].feature).toBe("export");
  expect(beh.topFeatures[0].uses).toBe(2);
});

test("drop-off funnel computes REAL rates from real events, UNKNOWN where no denominator", async () => {
  // 4 signups, 2 activate, 1 retained
  for (const u of ["a", "b", "c", "d"]) await recordProductEvent({ productKey: PK, eventType: "SIGNUP", userRef: u });
  for (const u of ["a", "b"]) await recordProductEvent({ productKey: PK, eventType: "ACTIVATION", userRef: u });
  await recordProductEvent({ productKey: PK, eventType: "SESSION_START", userRef: "a" });
  const f = await dropOffFunnel(PK);
  const activation = f.stages.find((s) => s.stage === "ACTIVATION")!;
  expect(activation.users).toBe(2);
  expect(activation.dropOffPct.label).toBe("REAL");
  expect(activation.dropOffPct.value).toBe(50); // 4 → 2 = 50% drop
});

test("a REAL bug ticket auto-creates an improvement task via the reality loop", async () => {
  const r = await createTicket({ productKey: PK, subject: "app crashes on export", body: "clicking export throws an error", category: "BUG" });
  expect(r.ticketId).toMatch(/^TICK-/);
  expect(r.taskId).toBeTruthy(); // real support → real work
  const ticket = await db.supportTicket.findUnique({ where: { ticketId: r.ticketId } });
  expect(ticket!.priority).toBe("HIGH"); // bug
  expect(ticket!.taskId).toBe(r.taskId!);
  const task = await db.genesisTask.findUnique({ where: { taskId: r.taskId! } });
  expect(task).not.toBeNull();
});

test("sentiment scoring is heuristic from real text; praise vs complaint counted", async () => {
  await createTicket({ productKey: PK, subject: "I love this, it's awesome and fast", category: "PRAISE" });
  await createTicket({ productKey: PK, subject: "terrible, broken and slow, I want a refund", category: "COMPLAINT" });
  const sat = await satisfaction(PK);
  expect(sat.praise).toBeGreaterThanOrEqual(1);
  expect(sat.complaints).toBeGreaterThanOrEqual(1);
  expect(sat.ticketCount).toBe(2);
});

test("CSAT stays UNKNOWN below a real sample, becomes REAL with enough scored tickets", async () => {
  await createTicket({ productKey: PK, subject: "great tool", category: "PRAISE" });
  let sat = await satisfaction(PK);
  expect(sat.csat.label).toBe("UNKNOWN"); // < 5 scored
  for (let i = 0; i < 5; i++) await createTicket({ productKey: PK, subject: `love it, excellent ${i}`, category: "PRAISE" });
  sat = await satisfaction(PK);
  expect(sat.csat.label).toBe("REAL");
  expect(sat.csat.value).toBeGreaterThan(50); // mostly positive
});

test("recurring real ticket themes generate improvement tasks (≥2 only)", async () => {
  await createTicket({ productKey: PK, subject: "the app is really slow to load", category: "QUESTION" });
  await createTicket({ productKey: PK, subject: "performance is bad, everything lags", category: "QUESTION" });
  const r = await generateImprovementTasks();
  const perf = r.themes.find((t) => t.theme === "performance");
  expect(perf!.count).toBeGreaterThanOrEqual(2);
  expect(r.tasksCreated.length).toBeGreaterThanOrEqual(1);
});

test("customer health reflects real usage + sentiment", async () => {
  for (const u of ["u1", "u2", "u3"]) { await recordProductEvent({ productKey: PK, eventType: "SIGNUP", userRef: u }); await recordProductEvent({ productKey: PK, eventType: "ACTIVATION", userRef: u }); }
  await createTicket({ productKey: PK, subject: "love it, works great", category: "PRAISE" });
  const h = await customerHealth(PK);
  expect(h.score.label).toBe("REAL");
  expect(["HEALTHY", "AT_RISK", "CHURNING"]).toContain(h.status);
  expect(h.drivers.length).toBeGreaterThan(0);
});

test("ticket status transitions and resolves", async () => {
  const r = await createTicket({ productKey: PK, subject: "how do I export?", category: "QUESTION" });
  expect((await updateTicket(r.ticketId, "RESOLVED")).ok).toBe(true);
  const t = await db.supportTicket.findUnique({ where: { ticketId: r.ticketId } });
  expect(t!.status).toBe("RESOLVED");
  expect(t!.resolvedAt).not.toBeNull();
});

test("overview aggregates real tickets + honest empty behavior", async () => {
  await createTicket({ productKey: PK, subject: "question about billing", category: "QUESTION" });
  const o = await customerSuccessOverview();
  expect(o.hasRealData).toBe(true);
  expect(o.tickets.total).toBeGreaterThanOrEqual(1);
  expect(o.note).toContain("never fabricated");
});
