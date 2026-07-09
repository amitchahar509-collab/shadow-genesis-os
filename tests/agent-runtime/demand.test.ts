/** V8 G3 — Demand Graph + Product DNA tests: fingerprint, customer match, ranking, honesty, graph projection. */

import { test, expect, beforeEach } from "bun:test";
import { promises as fs } from "node:fs";
import { db } from "@/lib/db";
import { computeProductDNA, matchDemand, analyzeDemand, classifyCategory } from "@/lib/genesis/agent-runtime/demand";

beforeEach(async () => {
  await db.demandMatch.deleteMany({ where: { subject: { startsWith: "TESTDEMAND" } } });
  await db.productDNA.deleteMany({ where: { subject: { startsWith: "TESTDEMAND" } } });
  await db.customerSimulation.deleteMany({ where: { subject: { startsWith: "TESTDEMAND" } } });
  await db.knowledgeNode.deleteMany({ where: { label: { startsWith: "TESTDEMAND" } } });
});

test("classifyCategory maps keywords to a category", () => {
  expect(classifyCategory("AI bookkeeping and invoicing for freelancers")).toBe("Fintech");
  expect(classifyCategory("developer API deploy tool with CI")).toBe("Devtools");
  expect(classifyCategory("a standup meeting notes workflow")).toBe("Productivity");
  expect(classifyCategory("something totally generic")).toBe("Other");
});

test("computeProductDNA fingerprints a product deterministically", async () => {
  const dna = await computeProductDNA({ subject: "TESTDEMAND invoicing for freelancers", problem: "manual invoicing wastes hours", targetUsers: "freelancers" });
  expect(dna.dnaId).toMatch(/^DNA-\d{6}$/);
  expect(dna.category).toBe("Fintech");
  expect(dna.keywords).toContain("invoicing");
  expect(dna.keywords).not.toContain("for"); // stopwords removed
  const row = await db.productDNA.findUnique({ where: { dnaId: dna.dnaId } });
  expect(row).not.toBeNull();
});

test("matchDemand ranks segments by market fit and produces a DEMAND_MATCH_SCORE", async () => {
  const dna = await computeProductDNA({ subject: "TESTDEMAND fintech app", problem: "payment reconciliation", targetUsers: "finance teams" });
  const m = await matchDemand(dna, { personaCount: 200 });
  expect(m.matchId).toMatch(/^DM-\d{6}$/);
  expect(m.segments.length).toBeGreaterThan(0);
  expect(m.demandScore).toBeGreaterThanOrEqual(0);
  expect(m.demandScore).toBeLessThanOrEqual(100);
  // segments are sorted by marketFit desc, and topSegment matches the head
  for (let i = 1; i < m.segments.length; i++) expect(m.segments[i - 1].marketFit).toBeGreaterThanOrEqual(m.segments[i].marketFit);
  expect(m.topSegment).toBe(m.segments[0].industry);
  // every segment answers who/where/why-now with real adoption + a fit
  for (const s of m.segments) {
    expect(typeof s.adoptionProbability).toBe("number");
    expect(s.community.length).toBeGreaterThan(0);
    expect(["LOW", "MEDIUM", "HIGH"]).toContain(s.urgency);
    expect(s.whyNow.length).toBeGreaterThan(0);
  }
});

test("category affinity lifts the right industries' need score", async () => {
  const dna = await computeProductDNA({ subject: "TESTDEMAND fintech reconciliation", problem: "bank payment reconciliation", targetUsers: "finance teams" });
  const m = await matchDemand(dna, { personaCount: 240 });
  const finance = m.segments.find((s) => s.industry === "Finance");
  const edu = m.segments.find((s) => s.industry === "Education");
  // Finance is a Fintech affinity industry → its need score should beat a non-affinity one at similar adoption.
  if (finance && edu) expect(finance.needScore).toBeGreaterThanOrEqual(edu.needScore);
});

test("honesty: adoption is SIMULATION-labelled in the artifact", async () => {
  const dna = await computeProductDNA({ subject: "TESTDEMAND labelled", problem: "x", targetUsers: "y" });
  const m = await matchDemand(dna, { personaCount: 120 });
  const md = await fs.readFile(m.artifactPath, "utf8");
  expect(md).toContain("SIMULATION");
  expect(md).toContain("DEMAND_MAP");
  expect(m.mode).toBe("HEURISTIC");
});

test("demand match projects product ↔ industry edges into the knowledge graph", async () => {
  const dna = await computeProductDNA({ subject: "TESTDEMAND graph product", problem: "graph problem", targetUsers: "teams" });
  await matchDemand(dna, { personaCount: 200 });
  const productNode = await db.knowledgeNode.findFirst({ where: { label: "TESTDEMAND graph product" } });
  expect(productNode).not.toBeNull();
  const edges = await db.knowledgeEdge.findMany({ where: { fromNodeId: productNode!.id } });
  expect(edges.length).toBeGreaterThan(0); // product linked to problem + top industries
});

test("analyzeDemand is one-shot: DNA then match on an opportunity", async () => {
  await db.opportunity.create({ data: { opportunityId: "OPP-TESTDEMAND", title: "TESTDEMAND devtool", problem: "developers waste time on CI", market: "devtools", targetUsers: "developers", potentialValue: 8, difficulty: 4, confidence: 70, evidence: "[]", competition: JSON.stringify([{ title: "Jenkins" }]), source: "t" } });
  const { dna, match } = await analyzeDemand({ opportunityId: "OPP-TESTDEMAND", personaCount: 200 });
  expect(dna.category).toBe("Devtools");
  expect(dna.alternatives).toContain("Jenkins");
  expect(match.topSegment.length).toBeGreaterThan(0);
  await db.demandMatch.deleteMany({ where: { dnaId: dna.dnaId } });
  await db.productDNA.deleteMany({ where: { dnaId: dna.dnaId } });
  await db.opportunity.deleteMany({ where: { opportunityId: "OPP-TESTDEMAND" } });
});
