/** V8 G4 — Acquisition Engine tests: the experiment ladder, honesty labels, approval gating, experiment memory. */

import { test, expect, beforeEach } from "bun:test";
import { db } from "@/lib/db";
import { getAgent, AGENT_NAMES } from "@/lib/genesis/agent-runtime/agents";
import { decide } from "@/lib/genesis/agent-runtime/approvals";

const SUBJ = "TESTACQ product";
const ctx = { subject: SUBJ, potentialValue: 8, competition: 3, personaCount: 100, price: 40 };

async function cycle(extra: Record<string, unknown> = {}) {
  const r = await getAgent("ACQUISITION")!.execute({ goal: `cycle: ${SUBJ}`, context: { ...ctx, ...extra } });
  expect(r.status).toBe("SUCCESS");
  return r.output as { experimentId: string; kind: string; status: string; dataSource: string; learning: string; winnerPrice?: number; winnerSegment?: string };
}

beforeEach(async () => {
  await db.growthExperiment.deleteMany({ where: { subject: { startsWith: "TESTACQ" } } });
  await db.approvalRequest.deleteMany({ where: { agent: "ACQUISITION" } });
  await db.customerSimulation.deleteMany({ where: { subject: { startsWith: "TESTACQ" } } });
  await db.claim.deleteMany({ where: { statement: { contains: "TESTACQ" } } });
});

test("registry: ACQUISITION agent is registered", () => {
  expect(AGENT_NAMES).toContain("ACQUISITION");
  expect(getAgent("ACQUISITION")?.name).toBe("ACQUISITION");
});

test("cycle 1 — PRICING: 3 simulated price points, a winner, SIMULATION-labelled learning", async () => {
  const out = await cycle();
  expect(out.kind).toBe("PRICING");
  expect(out.status).toBe("LEARNED");
  expect(out.dataSource).toBe("SIMULATION");
  expect(out.learning).toContain("[SIMULATION]");
  expect(out.winnerPrice).toBeGreaterThan(0);
  const row = await db.growthExperiment.findUnique({ where: { experimentId: out.experimentId } });
  const result = JSON.parse(row!.result) as { points: { price: number }[]; winner: number };
  expect(result.points.length).toBe(3);
  expect(result.winner).toBe(out.winnerPrice!);
});

test("pricing winner is deterministic (seeded simulation)", async () => {
  const a = await cycle();
  await db.growthExperiment.deleteMany({ where: { subject: SUBJ } }); // reset memory
  const b = await cycle();
  expect(a.winnerPrice).toBe(b.winnerPrice);
});

test("cycle 2 — AUDIENCE: ladder advances from memory; names a winning segment", async () => {
  await cycle(); // PRICING
  const out = await cycle();
  expect(out.kind).toBe("AUDIENCE");
  expect(out.status).toBe("LEARNED");
  expect(out.dataSource).toBe("SIMULATION");
  expect(out.winnerSegment).toBeDefined();
  expect(out.learning).toContain(out.winnerSegment!);
});

test("cycle 3 — CHANNEL: real external action → approval queue, zero fabricated results", async () => {
  await cycle(); await cycle(); // PRICING + AUDIENCE
  const out = await cycle();
  expect(out.kind).toBe("CHANNEL");
  expect(out.status).toBe("AWAITING_APPROVAL");
  expect(out.dataSource).toBe("NONE"); // no data exists and none was invented
  const row = await db.growthExperiment.findUnique({ where: { experimentId: out.experimentId } });
  expect(row!.approvalId).toMatch(/^APR-\d{6}$/);
  const result = JSON.parse(row!.result) as Record<string, unknown>;
  expect(result.conversions).toBeUndefined(); // nothing measured
  expect(result.buyRate).toBeUndefined();
  // Cycle 4 while pending: still blocked, still honest.
  const again = await cycle();
  expect(again.status).toBe("AWAITING_APPROVAL");
  expect(again.learning).toContain("blocked on human approval");
});

test("channel decisions: rejection kills the experiment; approval → AWAITING_EXECUTION, never fabricated", async () => {
  await cycle(); await cycle(); const ch = await cycle();
  const row = await db.growthExperiment.findUnique({ where: { experimentId: ch.experimentId } });
  // Reject → killed with a learning
  await decide(row!.approvalId!, { approve: false, decidedBy: "human@test" });
  const afterReject = await cycle();
  expect(afterReject.status).toBe("KILLED");
  const killed = await db.growthExperiment.findUnique({ where: { experimentId: ch.experimentId } });
  expect(killed!.status).toBe("KILLED");
  expect(killed!.learning).toContain("rejected");
  // New channel proposal on the next cycle (previous one killed)
  const retry = await cycle();
  expect(retry.kind).toBe("CHANNEL");
  expect(retry.status).toBe("AWAITING_APPROVAL");
  const retryRow = await db.growthExperiment.findUnique({ where: { experimentId: retry.experimentId } });
  await decide(retryRow!.approvalId!, { approve: true, decidedBy: "human@test" });
  const afterApprove = await cycle();
  expect(afterApprove.status).toBe("AWAITING_EXECUTION");
  expect(afterApprove.learning).toContain("will not fabricate");
}, 30_000);

test("experiment memory: learnings persist and are queryable per subject", async () => {
  await cycle(); await cycle();
  const rows = await db.growthExperiment.findMany({ where: { subject: SUBJ, learning: { not: null } } });
  expect(rows.length).toBe(2);
  for (const r of rows) expect(r.dataSource).toBe("SIMULATION"); // every measured learning carries its honesty label
});
