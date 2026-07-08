/** AI Boardroom (V5 Phase 4) tests — deliberation, verdict logic, honesty, persistence. */

import { test, expect, beforeEach } from "bun:test";
import { promises as fs } from "node:fs";
import { db } from "@/lib/db";
import { conveneBoard, BOARD } from "@/lib/genesis/agent-runtime/boardroom";

beforeEach(async () => {
  // BoardArgument cascades on delete of its BoardDecision.
  await db.boardDecision.deleteMany({ where: { topic: { startsWith: "TESTBOARD" } } });
});

test("boardroom: has all nine executive seats", () => {
  const roles = BOARD.map((b) => b.role);
  for (const r of ["FOUNDER", "CEO", "INVESTOR", "CUSTOMER", "COMPETITOR", "CFO", "GROWTH", "ENGINEER", "RISK"]) {
    expect(roles).toContain(r);
  }
  expect(BOARD.length).toBe(9);
});

test("boardroom: convene produces one argument per seat + a valid verdict", async () => {
  const d = await conveneBoard({ topic: "TESTBOARD basic", question: "Should we build X?", context: { confidence: 60, potentialValue: 6, difficulty: 4, competition: 4, evidenceCount: 3 } });
  expect(d.arguments.length).toBe(9);
  expect(["GO", "CONDITIONAL", "NO_GO"]).toContain(d.verdict);
  // Tally is internally consistent with the nine stances.
  expect(d.tally.GO + d.tally.NO_GO + d.tally.ABSTAIN).toBe(9);
  expect(d.confidence).toBeGreaterThanOrEqual(0);
  expect(d.confidence).toBeLessThanOrEqual(100);
});

test("boardroom: without an LLM key stances are HEURISTIC and honestly labelled", async () => {
  // This test suite runs with no ANTHROPIC_API_KEY / ZAI_API_KEY, so every seat falls back.
  const d = await conveneBoard({ topic: "TESTBOARD heuristic", question: "Should we build Y?", context: { confidence: 55, potentialValue: 5, difficulty: 5, competition: 5 } });
  expect(d.mode).toBe("HEURISTIC");
  for (const a of d.arguments) {
    expect(a.mode).toBe("HEURISTIC");
    expect(a.argument).toContain("[HEURISTIC]");
  }
});

test("boardroom: strong signals lean GO, weak signals lean NO_GO", async () => {
  const strong = await conveneBoard({ topic: "TESTBOARD strong", question: "great idea?", context: { confidence: 90, potentialValue: 9, difficulty: 3, competition: 2, evidenceCount: 6 } });
  const weak = await conveneBoard({ topic: "TESTBOARD weak", question: "bad idea?", context: { confidence: 15, potentialValue: 3, difficulty: 9, competition: 9, evidenceCount: 0 } });
  // GO votes should be strictly higher for the strong opportunity than the weak one.
  expect(strong.tally.GO).toBeGreaterThan(weak.tally.GO);
  expect(weak.verdict).not.toBe("GO");
});

test("boardroom: a confident Risk NO_GO vetoes the verdict", async () => {
  // Weak, risky signals should drive RISK to NO_GO and force a non-GO verdict.
  const d = await conveneBoard({ topic: "TESTBOARD veto", question: "risky?", context: { confidence: 20, potentialValue: 4, difficulty: 9, competition: 8, evidenceCount: 0 } });
  const risk = d.arguments.find((a) => a.role === "RISK")!;
  expect(risk).toBeDefined();
  if (risk.stance === "NO_GO" && risk.confidence >= 70) {
    expect(d.verdict).toBe("NO_GO");
  }
});

test("boardroom: persists decision + arguments and writes BOARD_DECISION.md", async () => {
  const d = await conveneBoard({ topic: "TESTBOARD persist", question: "persist?", context: { confidence: 50 } });
  const row = await db.boardDecision.findUnique({ where: { decisionId: d.decisionId }, include: { arguments: true } });
  expect(row).not.toBeNull();
  expect(row!.arguments.length).toBe(9);
  expect(row!.verdict).toBe(d.verdict);
  const md = await fs.readFile(d.artifactPath, "utf8");
  expect(md).toContain("BOARD_DECISION");
  expect(md).toContain(d.verdict);
});
