/** V8 G0 — Integrated Autonomous Pipeline tests: chaining, gating, honesty. */

import { test, expect, beforeEach } from "bun:test";
import { promises as fs } from "node:fs";
import { db } from "@/lib/db";
import { createCompany } from "@/lib/genesis/agent-runtime/pipeline/company";

async function seedOpportunity(id: string, over: Partial<{ title: string; potentialValue: number; difficulty: number; confidence: number; evidence: string }>) {
  await db.opportunity.create({
    data: {
      opportunityId: id, title: over.title ?? `TESTPIPE ${id}`, problem: "test problem", market: "test market",
      targetUsers: "test users", potentialValue: over.potentialValue ?? 5, difficulty: over.difficulty ?? 5,
      confidence: over.confidence ?? 50, evidence: over.evidence ?? "[]", competition: "[]", source: "TESTPIPE",
    },
  });
}

beforeEach(async () => {
  await db.ventureRun.deleteMany({ where: { opportunityTitle: { startsWith: "TESTPIPE" } } });
  await db.company.deleteMany({ where: { key: { startsWith: "co-opp-testpipe" } } });
  await db.opportunity.deleteMany({ where: { opportunityId: { startsWith: "OPP-TESTPIPE" } } });
  await db.claim.deleteMany({ where: { subject: { startsWith: "OPP-TESTPIPE" } } });
  await db.customerSimulation.deleteMany({ where: { subject: { startsWith: "TESTPIPE" } } });
  await db.ventureAnalysis.deleteMany({ where: { subject: { startsWith: "TESTPIPE" } } });
});

test("pipeline: weak opportunity → board NO_GO halts before build", async () => {
  await seedOpportunity("OPP-TESTPIPE-WEAK", { potentialValue: 2, difficulty: 9, confidence: 5, evidence: "[]" });
  const r = await createCompany({ opportunityId: "OPP-TESTPIPE-WEAK", personaCount: 80, build: false });
  expect(r.status).toBe("HALTED_NO_GO");
  expect(r.board?.verdict).toBe("NO_GO");
  expect(r.companyKey).toBeUndefined(); // no company on a NO_GO
  const row = await db.ventureRun.findUnique({ where: { runId: r.runId } });
  expect(row!.status).toBe("HALTED_NO_GO");
}, 60_000);

test("pipeline: strong evidence-backed opportunity → passes gates, creates Company (PLANNED without build)", async () => {
  await seedOpportunity("OPP-TESTPIPE-STRONG", {
    potentialValue: 9, difficulty: 3, confidence: 85,
    evidence: JSON.stringify([
      { url: "https://a", snippet: "acute pain reported" }, { url: "https://b", snippet: "spend rising" },
      { url: "https://c", snippet: "underserved segment" }, { url: "https://d", snippet: "adoption growing" },
    ]),
  });
  const r = await createCompany({ opportunityId: "OPP-TESTPIPE-STRONG", personaCount: 80, build: false });
  expect(r.status).toBe("PLANNED");
  expect(r.board?.verdict).not.toBe("NO_GO");
  expect(r.companyKey).toBeDefined();
  const company = await db.company.findUnique({ where: { key: r.companyKey! } });
  expect(company).not.toBeNull();
  expect(company!.status).toBe("ACTIVE");
  // All four intelligence gates produced scores.
  expect(r.ventureScore).toBeGreaterThan(0);
  expect(r.customerRealityScore).toBeGreaterThan(0);
  expect(r.stages.map((s) => s.stage)).toEqual(["DISCOVER", "VENTURE", "CUSTOMER", "BOARD"]);
}, 60_000);

test("pipeline: artifact carries honesty labels (HEURISTIC + SIMULATION) end to end", async () => {
  await seedOpportunity("OPP-TESTPIPE-HONEST", { potentialValue: 7, confidence: 60 });
  const r = await createCompany({ opportunityId: "OPP-TESTPIPE-HONEST", personaCount: 60, build: false });
  expect(r.artifactPath).toBeDefined();
  const md = await fs.readFile(r.artifactPath!, "utf8");
  expect(md).toContain("HEURISTIC"); // no LLM key in tests
  expect(md).toContain("SIMULATION"); // customer numbers labelled
  expect(md).toContain("VENTURE_RUN");
  const labels = r.stages.flatMap((s) => s.labels);
  expect(labels).toContain("SIMULATION");
}, 60_000);

test("pipeline: autonomous discovery (no idea) completes all gates and records a run", async () => {
  const r = await createCompany({ focus: "TESTPIPE niche productivity", personaCount: 60, build: false });
  expect(["PLANNED", "HALTED_NO_GO"]).toContain(r.status); // outcome depends on verdict; both are honest completions
  expect(r.opportunity).toBeDefined(); // it found its own opportunity
  expect(r.stages.length).toBe(4); // DISCOVER, VENTURE, CUSTOMER, BOARD
  const row = await db.ventureRun.findUnique({ where: { runId: r.runId } });
  expect(row).not.toBeNull();
  expect(row!.boardVerdict).toBe(r.board!.verdict);
  // Cleanup the discovered artifacts of this test run
  if (r.opportunity) {
    await db.claim.deleteMany({ where: { subject: r.opportunity.opportunityId } });
    await db.opportunity.deleteMany({ where: { opportunityId: r.opportunity.opportunityId } });
    if (r.companyKey) await db.company.deleteMany({ where: { key: r.companyKey } });
    await db.ventureRun.deleteMany({ where: { runId: r.runId } });
  }
}, 120_000);

test("pipeline: unknown opportunityId fails honestly", async () => {
  const r = await createCompany({ opportunityId: "OPP-TESTPIPE-NOPE", build: false });
  expect(r.status).toBe("FAILED");
  expect(r.error).toContain("not found");
}, 30_000);
