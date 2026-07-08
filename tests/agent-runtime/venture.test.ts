/** V6 AI Venture Analyst tests — scoring, verdict, honesty, persistence, board handoff. */

import { test, expect, beforeEach } from "bun:test";
import { promises as fs } from "node:fs";
import { db } from "@/lib/db";
import { getAgent, AGENT_NAMES } from "@/lib/genesis/agent-runtime/agents";
import { conveneBoard } from "@/lib/genesis/agent-runtime/boardroom";

beforeEach(async () => {
  await db.ventureAnalysis.deleteMany({ where: { subject: { startsWith: "TESTVC" } } });
  await db.boardDecision.deleteMany({ where: { topic: { startsWith: "TESTVC" } } });
});

test("registry: VENTURE agent is registered", () => {
  expect(AGENT_NAMES).toContain("VENTURE");
  expect(getAgent("VENTURE")?.name).toBe("VENTURE");
});

test("venture: scores seven dimensions and produces a verdict + artifact", async () => {
  const agent = getAgent("VENTURE")!;
  const r = await agent.execute({ goal: "TESTVC strong idea", context: { subject: "TESTVC strong idea", potentialValue: 9, difficulty: 3, confidence: 85, competition: 2, evidenceCount: 5 } });
  expect(r.status).toBe("SUCCESS");
  const out = r.output as { ventureScore: number; verdict: string; marketSize: number; moat: number; growthPotential: number };
  expect(out.ventureScore).toBeGreaterThanOrEqual(0);
  expect(out.ventureScore).toBeLessThanOrEqual(100);
  expect(["INVEST", "WATCH", "PASS"]).toContain(out.verdict);
  const artifact = r.artifacts.find((a) => a.description === "VENTURE_SCORE")!;
  expect(artifact).toBeDefined();
  const md = await fs.readFile(artifact.path, "utf8");
  expect(md).toContain("VENTURE_SCORE");
});

test("venture: strong signals outscore weak signals", async () => {
  const agent = getAgent("VENTURE")!;
  const strong = await agent.execute({ goal: "TESTVC strong", context: { subject: "TESTVC strong", potentialValue: 9, difficulty: 3, confidence: 85, competition: 2, evidenceCount: 6 } });
  const weak = await agent.execute({ goal: "TESTVC weak", context: { subject: "TESTVC weak", potentialValue: 3, difficulty: 9, confidence: 20, competition: 9, evidenceCount: 0 } });
  const s = (strong.output as { ventureScore: number }).ventureScore;
  const w = (weak.output as { ventureScore: number }).ventureScore;
  expect(s).toBeGreaterThan(w);
  expect((weak.output as { verdict: string }).verdict).not.toBe("INVEST");
});

test("venture: without an LLM key, mode is HEURISTIC and unknowns are declared", async () => {
  const agent = getAgent("VENTURE")!;
  const r = await agent.execute({ goal: "TESTVC honest", context: { subject: "TESTVC honest", potentialValue: 6, competition: 5, evidenceCount: 0 } });
  const row = await db.ventureAnalysis.findFirst({ where: { subject: "TESTVC honest" }, orderBy: { createdAt: "desc" } });
  expect(row).not.toBeNull();
  expect(row!.mode).toBe("HEURISTIC");
  const unknowns = JSON.parse(row!.unknowns) as string[];
  expect(unknowns.length).toBeGreaterThan(0); // must not present a thin analysis as conviction
});

test("venture: persists a VC-numbered analysis row", async () => {
  const agent = getAgent("VENTURE")!;
  const r = await agent.execute({ goal: "TESTVC persist", context: { subject: "TESTVC persist", potentialValue: 7 } });
  const analysisId = (r.output as { analysisId: string }).analysisId;
  expect(analysisId).toMatch(/^VC-\d{6}$/);
  const row = await db.ventureAnalysis.findUnique({ where: { analysisId } });
  expect(row).not.toBeNull();
});

test("venture → boardroom: a venture score drives the board verdict", async () => {
  // High venture score should not produce a NO_GO; a poor one should not produce a clean GO.
  const good = await conveneBoard({ topic: "TESTVC handoff good", question: "invest?", context: { ventureScore: 88, growthPotential: 90, competition: 90, difficulty: 3 } });
  const bad = await conveneBoard({ topic: "TESTVC handoff bad", question: "invest?", context: { ventureScore: 20, growthPotential: 15, competition: 10, difficulty: 9 } });
  expect(good.tally.GO).toBeGreaterThan(bad.tally.GO);
  expect(bad.verdict).not.toBe("GO");
});
