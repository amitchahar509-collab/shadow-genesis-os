/** AEGIS Truth Engine (V6 Phase 1) tests — the "no unsupported confidence" invariant. */

import { test, expect, beforeEach } from "bun:test";
import { db } from "@/lib/db";
import { assertClaim, scoreEvidence, verifySubject } from "@/lib/genesis/agent-runtime/aegis";
import { getAgent } from "@/lib/genesis/agent-runtime/agents";

beforeEach(async () => {
  await db.claim.deleteMany({ where: { statement: { startsWith: "TESTAEGIS" } } });
  await db.claim.deleteMany({ where: { subject: { startsWith: "TESTVCsub" } } });
});

test("aegis: no evidence ⇒ truthScore 0 and UNSUPPORTED (core invariant)", () => {
  const r = scoreEvidence([]);
  expect(r.truthScore).toBe(0);
  expect(r.verdict).toBe("UNSUPPORTED");
});

test("aegis: strong multi-source support ⇒ SUPPORTED", () => {
  const r = scoreEvidence([
    { stance: "SUPPORT", summary: "a", source: "x", weight: 0.9 },
    { stance: "SUPPORT", summary: "b", source: "y", weight: 0.9 },
    { stance: "SUPPORT", summary: "c", source: "z", weight: 0.8 },
    { stance: "SUPPORT", summary: "d", source: "w", weight: 0.8 },
  ]);
  expect(r.verdict).toBe("SUPPORTED");
  expect(r.truthScore).toBeGreaterThanOrEqual(60);
});

test("aegis: meaningful contradiction ⇒ CONTESTED", () => {
  const r = scoreEvidence([
    { stance: "SUPPORT", summary: "a", source: "x", weight: 0.8 },
    { stance: "SUPPORT", summary: "b", source: "y", weight: 0.8 },
    { stance: "CONTRADICT", summary: "c", source: "z", weight: 0.9 },
  ]);
  expect(r.verdict).toBe("CONTESTED");
  expect(r.contradictCount).toBe(1);
});

test("aegis: a single weak source cannot reach high confidence (volume damping)", () => {
  const r = scoreEvidence([{ stance: "SUPPORT", summary: "one", source: "x", weight: 0.5 }]);
  expect(r.truthScore).toBeLessThan(60);
});

test("aegis: assertClaim persists claim + evidence and computes truth", async () => {
  const t = await assertClaim({
    statement: "TESTAEGIS demand is rising",
    subject: "TESTVCsub-1", category: "DEMAND", source: "TEST",
    evidence: [
      { stance: "SUPPORT", summary: "survey", source: "http://a", sourceType: "WEB", weight: 0.8 },
      { stance: "SUPPORT", summary: "forum", source: "http://b", sourceType: "WEB", weight: 0.7 },
    ],
    unknowns: ["sample size unknown"],
  });
  expect(t.claimId).toMatch(/^CLM-\d{6}$/);
  const row = await db.claim.findUnique({ where: { claimId: t.claimId }, include: { evidence: true } });
  expect(row).not.toBeNull();
  expect(row!.evidence.length).toBe(2);
  expect(row!.evidence[0].evidenceId).toMatch(/^EV-\d{6}$/);
  const v = await verifySubject("TESTVCsub-1");
  expect(v.claims).toBe(1);
});

test("venture ⇄ aegis: an evidence-less venture cannot reach INVEST", async () => {
  // A deliberately strong-scoring but source-less opportunity: without WEB evidence
  // the market claim is UNSUPPORTED, so INVEST must be capped to WATCH.
  const r = await getAgent("VENTURE")!.execute({
    goal: "TESTVCsub raw strong idea",
    context: { subject: "TESTVCsub raw strong idea", potentialValue: 9, difficulty: 2, confidence: 95, competition: 1, evidenceCount: 0 },
  });
  const out = r.output as { verdict: string; truthVerdict: string; ventureScore: number };
  expect(out.truthVerdict).toBe("UNSUPPORTED");
  expect(out.verdict).not.toBe("INVEST"); // capped despite a high raw score
});
