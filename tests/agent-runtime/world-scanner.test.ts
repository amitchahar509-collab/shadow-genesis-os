/** V8 G1 — World Scanner tests: discover from real signals, grade, AEGIS-verify, promote, honest emptiness. */

import { test, expect, beforeEach } from "bun:test";
import { db } from "@/lib/db";
import { scanWorld, promoteToOpportunity } from "@/lib/genesis/agent-runtime/world-scanner";

async function clean() {
  await db.worldProblem.deleteMany({ where: { OR: [{ whoSuffers: { startsWith: "co-wptest" } }, { whoSuffers: { contains: "WPTEST" } }, { statement: { contains: "WPTEST" } }] } });
  await db.realitySignal.deleteMany({ where: { productKey: { startsWith: "co-wptest" } } });
  await db.opportunity.deleteMany({ where: { OR: [{ market: { contains: "WPTEST" } }, { source: { startsWith: "world-scanner" } }] } });
  await db.claim.deleteMany({ where: { statement: { contains: "WPTEST" } } });
}
beforeEach(clean);

async function seedRealityErrors(productKey: string, n: number) {
  for (let i = 0; i < n; i++) {
    await db.realitySignal.create({ data: { signalId: `RS-WPT-${productKey}-${i}`, kind: "ERROR", type: "FAILURE", source: "sentry", productKey, impact: "NEGATIVE", payload: JSON.stringify({ detail: `WPTEST 500 error in module ${i}` }), actedOn: true } });
  }
}

test("scan discovers a REALITY problem from clustered product error signals", async () => {
  await seedRealityErrors("co-wptest-alpha", 3);
  const r = await scanWorld();
  const p = r.problems.find((x) => x.whoSuffers === "co-wptest-alpha");
  expect(p).toBeDefined();
  expect(p!.dataSource).toBe("REALITY");
  expect(p!.frequency).toBe(3); // clustered count of real signals
  expect(p!.urgency).toBe("HIGH"); // errors are urgent
  expect(p!.problemId).toMatch(/^WP-\d{6}$/);
});

test("discovered problems are AEGIS-verified (real signals → supported; computed gaps → weaker)", async () => {
  await seedRealityErrors("co-wptest-beta", 4);
  const r = await scanWorld();
  const real = r.problems.find((x) => x.whoSuffers === "co-wptest-beta")!;
  expect(real.truthScore).toBeGreaterThan(0); // witnessed by real USER-typed evidence
  const claim = await db.claim.findFirst({ where: { subject: real.problemId } });
  expect(claim).not.toBeNull();
});

test("opportunity score rises with frequency + urgency", async () => {
  await seedRealityErrors("co-wptest-hi", 5);
  await seedRealityErrors("co-wptest-lo", 1);
  const r = await scanWorld();
  const hi = r.problems.find((x) => x.whoSuffers === "co-wptest-hi")!;
  const lo = r.problems.find((x) => x.whoSuffers === "co-wptest-lo")!;
  expect(hi.opportunityScore).toBeGreaterThan(lo.opportunityScore);
});

test("FAILED_VENTURE: repeatedly killed opportunities surface as a problem", async () => {
  for (let i = 0; i < 2; i++) {
    await db.opportunity.create({ data: { opportunityId: `OPP-WPTKILL-${i}`, title: `WPTEST killed attempt ${i}`, problem: "p", market: "WPTEST hard market", targetUsers: "u", status: "KILLED", evidence: "[]", competition: "[]", source: "t" } });
  }
  const r = await scanWorld();
  const failed = r.problems.find((x) => x.dataSource === "FAILED_VENTURE" && x.whoSuffers.includes("WPTEST"));
  expect(failed).toBeDefined();
  expect(failed!.frequency).toBe(2);
  await db.opportunity.deleteMany({ where: { opportunityId: { startsWith: "OPP-WPTKILL-" } } });
});

test("promote turns a discovered problem into a trackable Opportunity", async () => {
  await seedRealityErrors("co-wptest-promote", 3);
  const r = await scanWorld();
  const p = r.problems.find((x) => x.whoSuffers === "co-wptest-promote")!;
  const promoted = await promoteToOpportunity(p.problemId);
  expect(promoted).not.toBeNull();
  const opp = await db.opportunity.findUnique({ where: { opportunityId: promoted!.opportunityId } });
  expect(opp).not.toBeNull();
  expect(opp!.source).toContain(p.problemId);
  const wp = await db.worldProblem.findUnique({ where: { problemId: p.problemId } });
  expect(wp!.status).toBe("PROMOTED");
  // idempotent: promoting again returns the same opportunity
  const again = await promoteToOpportunity(p.problemId);
  expect(again!.opportunityId).toBe(promoted!.opportunityId);
  await db.opportunity.deleteMany({ where: { opportunityId: promoted!.opportunityId } });
});

test("honesty: positive feedback is not a problem; praise never becomes a WORLD problem", async () => {
  await db.realitySignal.create({ data: { signalId: "RS-WPT-praise", kind: "FEEDBACK", type: "USER_FEEDBACK", source: "survey", productKey: "co-wptest-happy", impact: "POSITIVE", payload: JSON.stringify({ detail: "WPTEST love it" }), sentiment: 0.9, actedOn: true } });
  const r = await scanWorld();
  expect(r.problems.find((x) => x.whoSuffers === "co-wptest-happy")).toBeUndefined();
});
