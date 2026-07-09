/** V8 G6 — Agent Arena tests: 3 real teams, data-driven judge, no hardcoded winner, learning loop. */

import { test, expect, beforeEach } from "bun:test";
import { promises as fs } from "node:fs";
import { db } from "@/lib/db";
import { runCompetition } from "@/lib/genesis/agent-runtime/arena";

beforeEach(async () => {
  await db.arenaCompetition.deleteMany({ where: { mission: { startsWith: "TESTARENA" } } }); // entries cascade
  await db.claim.deleteMany({ where: { statement: { contains: "TESTARENA" } } });
  await db.ventureAnalysis.deleteMany({ where: { subject: { contains: "TESTARENA" } } });
  await db.customerSimulation.deleteMany({ where: { subject: { contains: "TESTARENA" } } });
  // Arena memory is keyed by competitionId; ids can be reused after deletion, so
  // clear all arena-sourced memory to keep the learning-loop assertion isolated.
  await db.memoryEntry.deleteMany({ where: { source: { startsWith: "ARENA:" } } });
});

test("competition runs 3 teams, judges, and produces a winner with a rationale", async () => {
  const r = await runCompetition({ mission: "TESTARENA build a SaaS", potentialValue: 7, difficulty: 5, competition: 5 });
  expect(r.competitionId).toMatch(/^ARENA-\d{6}$/);
  expect(r.entries.length).toBe(3);
  expect(["ALPHA", "BETA", "GAMMA"]).toContain(r.winnerTeam);
  expect(r.rationale.length).toBeGreaterThan(10);
  // every team was scored by the real stack (no placeholder zeros across the board)
  for (const e of r.entries) {
    expect(e.ventureScore).toBeGreaterThan(0);
    expect(e.customerReality).toBeGreaterThan(0);
    expect(e.totalScore).toBeGreaterThanOrEqual(0);
  }
}, 60_000);

test("winner is argmax(totalScore) — never hardcoded", async () => {
  const r = await runCompetition({ mission: "TESTARENA argmax", potentialValue: 6, difficulty: 5, competition: 5 });
  const maxScore = Math.max(...r.entries.map((e) => e.totalScore));
  const winner = r.entries.find((e) => e.verdict === "WINNER")!;
  expect(winner.team).toBe(r.winnerTeam);
  expect(winner.totalScore).toBe(maxScore);
  expect(winner.rank).toBe(1);
  // ranks are a clean 1/2/3 with matching verdicts
  const ranks = r.entries.map((e) => e.rank).sort();
  expect(ranks).toEqual([1, 2, 3]);
  expect(r.entries.find((e) => e.rank === 2)!.verdict).toBe("RUNNER_UP");
  expect(r.entries.find((e) => e.rank === 3)!.verdict).toBe("REJECTED");
}, 60_000);

test("different missions can produce different winners (input-driven, not fixed)", async () => {
  // A low-difficulty, low-competition opportunity favours BETA's reliable/fast bet;
  // a high-value, crowded one shifts the balance. Assert the winner tracks the data,
  // not a constant — at minimum, the winning team is whoever tops the score each time.
  const easy = await runCompetition({ mission: "TESTARENA easy reliable", potentialValue: 5, difficulty: 8, competition: 8 });
  const bold = await runCompetition({ mission: "TESTARENA bold upside", potentialValue: 10, difficulty: 2, competition: 2 });
  // Each winner must be the top-scored entry of its own competition.
  for (const r of [easy, bold]) {
    const top = [...r.entries].sort((a, b) => b.totalScore - a.totalScore)[0];
    expect(r.winnerTeam).toBe(top.team);
  }
  // The two scenarios are genuinely different bets → their winning scores differ.
  expect(easy.winnerScore).not.toBe(bold.winnerScore);
}, 90_000);

test("each entry carries data + a per-dimension breakdown (evidence, feasibility, revenue, …)", async () => {
  const r = await runCompetition({ mission: "TESTARENA breakdown", potentialValue: 7, difficulty: 4, competition: 4 });
  const row = await db.arenaCompetition.findUnique({ where: { competitionId: r.competitionId }, include: { entries: true } });
  expect(row!.entries.length).toBe(3);
  for (const e of row!.entries) {
    const bd = JSON.parse(e.scoreBreakdown) as Record<string, number>;
    for (const dim of ["evidence", "feasibility", "customerValue", "revenue", "risk", "speed", "longTerm"]) {
      expect(typeof bd[dim]).toBe("number");
    }
    expect(e.entryId).toMatch(/^AE-\d{6}$/);
  }
}, 60_000);

test("board reviews the winning strategy + artifact written", async () => {
  const r = await runCompetition({ mission: "TESTARENA board", potentialValue: 8, difficulty: 3, competition: 3 });
  expect(["GO", "CONDITIONAL", "NO_GO"]).toContain(r.boardVerdict!);
  const md = await fs.readFile(r.artifactPath, "utf8");
  expect(md).toContain("ARENA_RESULT");
  expect(md).toContain(r.winnerTeam);
}, 60_000);

test("learning loop: winning pattern + failed strategies recorded to memory", async () => {
  const r = await runCompetition({ mission: "TESTARENA learn", potentialValue: 7, difficulty: 5, competition: 5 });
  const patterns = await db.memoryEntry.findMany({ where: { source: `ARENA:${r.competitionId}` } });
  expect(patterns.length).toBe(3); // 1 winning pattern + 2 failed strategies
  expect(patterns.some((p) => p.tags.includes("winning-pattern"))).toBe(true);
  expect(patterns.filter((p) => p.tags.includes("failed-strategy")).length).toBe(2);
}, 60_000);
