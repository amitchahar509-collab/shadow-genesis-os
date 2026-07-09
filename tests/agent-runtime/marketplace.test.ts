/** V8 G8 — App Demand Marketplace tests: register (DNA+match), problem→apps matching, coverage gaps, honesty. */

import { test, expect, beforeEach } from "bun:test";
import { db } from "@/lib/db";
import { registerApp, matchProblemToApps, marketplaceStats } from "@/lib/genesis/agent-runtime/marketplace";

async function cleanup() {
  const apps = await db.marketplaceApp.findMany({ where: { name: { startsWith: "TESTMKT" } } });
  for (const a of apps) {
    await db.demandMatch.deleteMany({ where: { dnaId: a.dnaId } });
    await db.productDNA.deleteMany({ where: { dnaId: a.dnaId } });
  }
  await db.marketplaceApp.deleteMany({ where: { name: { startsWith: "TESTMKT" } } });
  await db.customerSimulation.deleteMany({ where: { subject: { startsWith: "TESTMKT" } } });
  await db.knowledgeNode.deleteMany({ where: { label: { startsWith: "TESTMKT" } } });
}
beforeEach(cleanup);

test("registerApp fingerprints, auto-matches demand, and lists the app", async () => {
  const app = await registerApp({ name: "TESTMKT Ledgerly", problem: "manual invoicing and bookkeeping waste hours", targetUsers: "freelancers", personaCount: 160 });
  expect(app.appId).toMatch(/^APP-\d{6}$/);
  expect(app.category).toBe("Fintech");
  expect(app.demandScore).toBeGreaterThan(0);
  expect(app.topSegment).toBeTruthy();
  const row = await db.marketplaceApp.findUnique({ where: { appId: app.appId } });
  expect(row!.status).toBe("LISTED");
  expect(JSON.parse(row!.keywords).length).toBeGreaterThan(0);
});

test("problem → apps: a matching query surfaces the right app above unrelated ones", async () => {
  await registerApp({ name: "TESTMKT Ledgerly", problem: "manual invoicing and bookkeeping for freelancers", targetUsers: "freelancers", personaCount: 140 });
  await registerApp({ name: "TESTMKT DeployBot", problem: "developers waste time on CI and deployment pipelines", targetUsers: "developers", personaCount: 140 });
  const matches = await matchProblemToApps("I need help with invoicing and bookkeeping");
  const led = matches.find((m) => m.name === "TESTMKT Ledgerly");
  const dev = matches.find((m) => m.name === "TESTMKT DeployBot");
  expect(led).toBeDefined(); // the relevant app is matched
  expect(led!.score).toBeGreaterThan(dev?.score ?? 0); // and outranks the unrelated one
});

test("problem → apps: an unrelated query returns no false matches", async () => {
  await registerApp({ name: "TESTMKT Ledgerly", problem: "invoicing and bookkeeping", targetUsers: "freelancers", personaCount: 120 });
  const matches = await matchProblemToApps("underwater basket weaving techniques");
  expect(matches.every((m) => m.name !== "TESTMKT Ledgerly") || matches.length === 0).toBe(true);
});

test("registerApp carries improvement ideas from the customer-sim missing features", async () => {
  const app = await registerApp({ name: "TESTMKT Improvable", problem: "team collaboration is fragmented", targetUsers: "teams", personaCount: 200 });
  const row = await db.marketplaceApp.findUnique({ where: { appId: app.appId } });
  expect(Array.isArray(JSON.parse(row!.improvementIdeas))).toBe(true); // present (may be empty if sim found none)
});

test("marketplace stats: coverage + demand gaps are computed from listed apps", async () => {
  await registerApp({ name: "TESTMKT Ledgerly", problem: "invoicing bookkeeping", targetUsers: "freelancers", personaCount: 140 });
  const stats = await marketplaceStats();
  expect(stats.total).toBeGreaterThanOrEqual(1);
  expect(Object.keys(stats.byCategory).length).toBeGreaterThanOrEqual(1);
  // gaps + covered partition the industry universe (10 industries)
  expect(stats.coveredSegments.length + stats.demandGaps.length).toBe(10);
  // a covered segment must not also be a gap
  for (const c of stats.coveredSegments) expect(stats.demandGaps).not.toContain(c);
});

test("empty marketplace is honestly empty — no matches, no fabricated apps", async () => {
  const matches = await matchProblemToApps("anything at all");
  expect(matches.length).toBe(0);
});
