/** V8 G5 — Long-Horizon Operator tests: tick scheduling, real-metric reviews, monthly board decisions, horizon completion. */

import { test, expect, beforeEach } from "bun:test";
import { db } from "@/lib/db";
import { startLongMission, tick } from "@/lib/genesis/agent-runtime/operator";

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-07-01T00:00:00Z");
const at = (days: number) => new Date(T0.getTime() + days * DAY);

async function seedOpp(id: string, over: Partial<{ potentialValue: number; difficulty: number; confidence: number }> = {}) {
  await db.opportunity.create({ data: { opportunityId: id, title: `TESTOP ${id}`, problem: "p", market: "m", targetUsers: "u", potentialValue: over.potentialValue ?? 7, difficulty: over.difficulty ?? 4, confidence: over.confidence ?? 70, evidence: "[]", competition: "[]", source: "TESTOP" } });
}

beforeEach(async () => {
  await db.longMission.deleteMany({ where: { goal: { startsWith: "TESTOP" } } }); // reviews cascade
  await db.opportunity.deleteMany({ where: { opportunityId: { startsWith: "OPP-TESTOP" } } });
  await db.ventureAnalysis.deleteMany({ where: { subject: { startsWith: "TESTOP" } } });
  await db.claim.deleteMany({ where: { subject: { startsWith: "OPP-TESTOP" } } });
  await db.boardDecision.deleteMany({ where: { topic: { startsWith: "Monthly review: TESTOP" } } });
  await db.genesisTask.deleteMany({ where: { title: { contains: "[LM-" } } });
  await db.agentExecution.deleteMany({ where: { executionId: { startsWith: "TESTOP-" } } });
});

test("mission: starts with the right horizon and endsAt", async () => {
  const m = await startLongMission({ goal: "TESTOP horizon", horizonDays: 60, now: T0 });
  expect(m.missionId).toMatch(/^LM-\d{6}$/);
  expect(m.status).toBe("ACTIVE");
  expect(m.endsAt.getTime()).toBe(T0.getTime() + 60 * DAY);
});

test("tick: first tick runs the DAILY baseline; a same-day second tick runs nothing", async () => {
  const m = await startLongMission({ goal: "TESTOP daily", now: T0 });
  const first = await tick(m.missionId, { now: at(0.1) });
  expect(first.ran).toEqual(["DAILY"]);
  const again = await tick(m.missionId, { now: at(0.5) });
  expect(again.ran).toEqual([]); // nothing due yet
  const nextDay = await tick(m.missionId, { now: at(1.2) });
  expect(nextDay.ran).toEqual(["DAILY"]);
});

test("daily review: real failures become findings and a QUALITY improvement task", async () => {
  const m = await startLongMission({ goal: "TESTOP failures", now: T0 });
  await db.agentExecution.create({ data: { executionId: "TESTOP-FAIL-1", agent: "ENGINEERING", goal: "x", status: "FAILED", startedAt: at(0.2) } });
  const r = await tick(m.missionId, { now: at(0.5) });
  expect(r.ran).toContain("DAILY");
  const review = await db.operatorReview.findFirst({ where: { missionId: m.missionId, kind: "DAILY" } });
  const findings = JSON.parse(review!.findings) as string[];
  expect(findings.some((f) => f.includes("failed execution"))).toBe(true);
  const task = await db.genesisTask.findFirst({ where: { title: { contains: `[${m.missionId}]` } } });
  expect(task).not.toBeNull();
  expect(task!.ownerAgent).toBe("QUALITY");
});

test("tick at +7d runs WEEKLY (venture re-check records a score)", async () => {
  await seedOpp("OPP-TESTOP-WK");
  const m = await startLongMission({ goal: "TESTOP weekly", opportunityId: "OPP-TESTOP-WK", now: T0 });
  await tick(m.missionId, { now: at(0.1) }); // daily baseline
  const r = await tick(m.missionId, { now: at(7.1) });
  expect(r.ran).toContain("WEEKLY");
  const review = await db.operatorReview.findFirst({ where: { missionId: m.missionId, kind: "WEEKLY" } });
  expect(review).not.toBeNull();
  const metrics = JSON.parse(review!.metrics) as { ventureScore?: number };
  expect(typeof metrics.ventureScore).toBe("number"); // real venture re-run happened
  const fresh = await db.longMission.findUnique({ where: { missionId: m.missionId } });
  expect((JSON.parse(fresh!.metrics) as { lastVentureScore: number }).lastVentureScore).toBe(metrics.ventureScore!);
});

test("tick at +30d runs MONTHLY and a healthy mission is not killed", async () => {
  await seedOpp("OPP-TESTOP-MO", { potentialValue: 8, difficulty: 3, confidence: 80 });
  const m = await startLongMission({ goal: "TESTOP monthly ok", opportunityId: "OPP-TESTOP-MO", horizonDays: 60, now: T0 });
  const r = await tick(m.missionId, { now: at(30.5) });
  expect(r.ran).toContain("MONTHLY");
  const fresh = await db.longMission.findUnique({ where: { missionId: m.missionId } });
  expect(["SCALE", "PIVOT", "DOUBLE_DOWN"]).toContain(fresh!.monthlyDecision!); // strong signals must not KILL
  expect(fresh!.status).toBe("ACTIVE");
});

test("monthly KILL: weak trend → board NO_GO → mission KILLED and company PAUSED", async () => {
  await seedOpp("OPP-TESTOP-KILL", { potentialValue: 2, difficulty: 9, confidence: 5 });
  await db.company.upsert({ where: { key: "co-testop-kill" }, create: { key: "co-testop-kill", name: "TESTOP kill co", mission: "m", status: "ACTIVE" }, update: { status: "ACTIVE" } });
  const m = await startLongMission({ goal: "TESTOP monthly kill", companyKey: "co-testop-kill", opportunityId: "OPP-TESTOP-KILL", horizonDays: 60, now: T0 });
  const r = await tick(m.missionId, { now: at(30.5) });
  const monthly = r.reviews.find((x) => x.kind === "MONTHLY");
  expect(monthly?.decision).toBe("KILL");
  const fresh = await db.longMission.findUnique({ where: { missionId: m.missionId } });
  expect(fresh!.status).toBe("KILLED");
  const company = await db.company.findUnique({ where: { key: "co-testop-kill" } });
  expect(company!.status).toBe("PAUSED");
  await db.company.deleteMany({ where: { key: "co-testop-kill" } });
});

test("horizon: tick past endsAt writes a FINAL review and completes the mission", async () => {
  const m = await startLongMission({ goal: "TESTOP final", horizonDays: 30, now: T0 });
  // Mark the periodic loops as freshly run so only the horizon check is due.
  await db.longMission.update({ where: { missionId: m.missionId }, data: { lastDailyAt: at(30.4), lastWeeklyAt: at(30.4), lastMonthlyAt: at(30.4) } });
  const r = await tick(m.missionId, { now: at(30.5) });
  expect(r.ran).toEqual(["FINAL"]);
  const fresh = await db.longMission.findUnique({ where: { missionId: m.missionId } });
  expect(fresh!.status).toBe("COMPLETED");
  const final = await db.operatorReview.findFirst({ where: { missionId: m.missionId, kind: "FINAL" } });
  expect(final).not.toBeNull();
  expect(final!.asOf.getTime()).toBe(at(30.5).getTime()); // simulated time recorded honestly
});

test("tick: inactive missions are not advanced", async () => {
  const m = await startLongMission({ goal: "TESTOP paused", now: T0 });
  await db.longMission.update({ where: { missionId: m.missionId }, data: { status: "PAUSED" } });
  const r = await tick(m.missionId, { now: at(5) });
  expect(r.ran).toEqual([]);
  expect(r.status).toBe("PAUSED");
});
