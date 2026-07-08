/** V7 Digital Customer Simulation tests — reality score, honesty, AEGIS + board handoff. */

import { test, expect, beforeEach } from "bun:test";
import { promises as fs } from "node:fs";
import { db } from "@/lib/db";
import { getAgent, AGENT_NAMES } from "@/lib/genesis/agent-runtime/agents";
import { conveneBoard } from "@/lib/genesis/agent-runtime/boardroom";

beforeEach(async () => {
  await db.customerSimulation.deleteMany({ where: { subject: { startsWith: "TESTCUST" } } });
  await db.claim.deleteMany({ where: { statement: { contains: "TESTCUST" } } });
  await db.boardDecision.deleteMany({ where: { topic: { startsWith: "TESTCUST" } } });
});

test("registry: CUSTOMER agent is registered", () => {
  expect(AGENT_NAMES).toContain("CUSTOMER");
  expect(getAgent("CUSTOMER")?.name).toBe("CUSTOMER");
});

test("customer: simulates personas → reality score + artifact + persona sample", async () => {
  const r = await getAgent("CUSTOMER")!.execute({ goal: "TESTCUST fit", context: { subject: "TESTCUST fit", potentialValue: 8, competition: 3, personaCount: 150, price: 40 } });
  expect(r.status).toBe("SUCCESS");
  const out = r.output as { buyRate: number; customerRealityScore: number; personaCount: number };
  expect(out.personaCount).toBe(150);
  expect(out.buyRate).toBeGreaterThanOrEqual(0);
  expect(out.customerRealityScore).toBeGreaterThanOrEqual(0);
  expect(out.customerRealityScore).toBeLessThanOrEqual(100);
  const artifact = r.artifacts.find((a) => a.description === "CUSTOMER_REALITY")!;
  const md = await fs.readFile(artifact.path, "utf8");
  expect(md).toContain("SIMULATION"); // honesty banner
  const sim = await db.customerSimulation.findFirst({ where: { subject: "TESTCUST fit" }, include: { personas: true }, orderBy: { createdAt: "desc" } });
  expect(sim!.personas.length).toBeGreaterThan(0); // persisted a sample
  expect(sim!.personas.length).toBeLessThanOrEqual(24); // not all 150
});

test("customer: strong fit outsells weak fit (deterministic)", async () => {
  const strong = await getAgent("CUSTOMER")!.execute({ goal: "TESTCUST strong", context: { subject: "TESTCUST strong", potentialValue: 9, competition: 2, personaCount: 300, price: 30 } });
  const weak = await getAgent("CUSTOMER")!.execute({ goal: "TESTCUST weak", context: { subject: "TESTCUST weak", potentialValue: 2, competition: 9, personaCount: 300, price: 200 } });
  const s = strong.output as { buyRate: number; customerRealityScore: number };
  const w = weak.output as { buyRate: number; customerRealityScore: number };
  expect(s.buyRate).toBeGreaterThan(w.buyRate);
  expect(s.customerRealityScore).toBeGreaterThan(w.customerRealityScore);
});

test("customer: reproducible for the same subject/signals (seeded RNG)", async () => {
  const a = await getAgent("CUSTOMER")!.execute({ goal: "TESTCUST seed", context: { subject: "TESTCUST seed", potentialValue: 6, competition: 5, personaCount: 100, price: 50 } });
  const b = await getAgent("CUSTOMER")!.execute({ goal: "TESTCUST seed", context: { subject: "TESTCUST seed", potentialValue: 6, competition: 5, personaCount: 100, price: 50 } });
  expect((a.output as { buyRate: number }).buyRate).toBe((b.output as { buyRate: number }).buyRate);
});

test("customer → aegis: asserts a SIMULATION-typed demand claim (never real evidence)", async () => {
  const r = await getAgent("CUSTOMER")!.execute({ goal: "TESTCUST aegis", context: { subject: "TESTCUST aegis", potentialValue: 8, competition: 3, personaCount: 120, price: 30 } });
  const simId = (r.output as { simulationId: string }).simulationId;
  const claim = await db.claim.findFirst({ where: { subject: simId }, include: { evidence: true } });
  expect(claim).not.toBeNull();
  expect(claim!.evidence[0].sourceType).toBe("SIMULATION");
  expect(claim!.evidence[0].weight).toBeLessThan(0.5); // simulation is weak evidence
});

test("customer → boardroom: a strong reality score lifts the Customer seat vs a weak one", async () => {
  const good = await conveneBoard({ topic: "TESTCUST board good", question: "build?", context: { customerRealityScore: 85 } });
  const bad = await conveneBoard({ topic: "TESTCUST board bad", question: "build?", context: { customerRealityScore: 15 } });
  const cGood = good.arguments.find((a) => a.role === "CUSTOMER")!;
  const cBad = bad.arguments.find((a) => a.role === "CUSTOMER")!;
  const rank = (s: string) => (s === "GO" ? 1 : s === "ABSTAIN" ? 0 : -1);
  expect(rank(cGood.stance)).toBeGreaterThan(rank(cBad.stance));
});
