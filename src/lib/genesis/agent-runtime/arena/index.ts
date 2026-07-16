/** Agent Arena (V8 G6) — teams compete, a judge picks the winner.
 *
 * Three teams each take the SAME mission and make a genuinely different
 * strategic bet on it (a transparent parameter transform reflecting the team's
 * focus — not fabricated data, a real trade-off):
 *
 *   ALPHA  innovation  — bolder upside, novel category, higher build risk,
 *                        thinner proof (unproven bets discount existing evidence).
 *   BETA   reliability — simpler/proven build, incremental upside, stronger
 *                        evidence weighting, lower risk.
 *   GAMMA  growth      — distribution edge + growth pricing, larger reach.
 *
 * Each bet is scored by the REAL stack — VENTURE (revenue/long-term), CUSTOMER
 * (customer value, seeded/reproducible), AEGIS (evidence quality) — then the
 * Judge weights the directive's seven dimensions into a total and selects
 * winner = argmax(totalScore). The winner is NEVER hardcoded: different
 * missions produce different winners, and every entry carries its data, a
 * per-dimension breakdown, a rank, and the judge's reason. The Boardroom then
 * reviews the winning strategy.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { db } from "@/lib/db";
import { getAgent } from "../agents";
import { conveneBoard } from "../boardroom";
import { assertClaim } from "../aegis";
import { getMemoryEngine } from "../memory/engine";
import { pickProvider } from "../types";
import { emit } from "../event-bus";
import { workspaceRoot } from "../workspace";

export type Team = "ALPHA" | "BETA" | "GAMMA";
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

interface BaseParams { subject: string; potentialValue: number; difficulty: number; confidence: number; competition: number; evidence: { url?: string; snippet?: string }[]; price: number; opportunityId?: string }

interface TeamDef {
  team: Team; focus: string;
  positioning(subject: string): string;
  /** Transform the base opportunity into this team's strategic bet. */
  transform(b: BaseParams): { potentialValue: number; difficulty: number; competition: number; price: number; personaCount: number; evidenceWeight: number };
}

const TEAMS: TeamDef[] = [
  {
    team: "ALPHA", focus: "innovation",
    positioning: (s) => `Disrupt: reframe "${s}" as a new category with a bold, novel product — win big or not at all.`,
    transform: (b) => ({ potentialValue: clamp(b.potentialValue * 1.15 + 0.5, 1, 10), difficulty: clamp(b.difficulty + 1.5, 1, 10), competition: clamp(b.competition * 0.85, 1, 10), price: Math.round(b.price * 1.1), personaCount: 200, evidenceWeight: 0.7 }),
  },
  {
    team: "BETA", focus: "reliability",
    positioning: (s) => `Execute reliably: ship a proven, well-engineered "${s}" fast with low risk and steady adoption.`,
    transform: (b) => ({ potentialValue: clamp(b.potentialValue * 0.9, 1, 10), difficulty: clamp(b.difficulty * 0.65, 1, 10), competition: clamp(b.competition, 1, 10), price: Math.round(b.price * 0.95), personaCount: 200, evidenceWeight: 1.0 }),
  },
  {
    team: "GAMMA", focus: "growth",
    positioning: (s) => `Win distribution: growth-priced "${s}" engineered for a repeatable, low-cost acquisition channel.`,
    transform: (b) => ({ potentialValue: clamp(b.potentialValue, 1, 10), difficulty: clamp(b.difficulty * 0.9, 1, 10), competition: clamp(b.competition * 0.8, 1, 10), price: Math.round(b.price * 0.8), personaCount: 260, evidenceWeight: 0.9 }),
  },
];

// Judge weights over the directive's seven dimensions (sum = 1).
const W = { evidence: 0.15, feasibility: 0.15, customerValue: 0.2, revenue: 0.2, risk: 0.1, speed: 0.1, longTerm: 0.1 };

export interface ArenaEntryResult {
  entryId: string; team: Team; focus: string; positioning: string;
  ventureScore: number; truthScore: number; customerReality: number; buyRate: number; feasibility: number; risk: number;
  totalScore: number; rank: number; verdict: string; breakdown: Record<string, number>;
}
export interface ArenaResult {
  competitionId: string; mission: string; status: string; mode: string;
  winnerTeam: Team; winnerScore: number; rationale: string;
  boardVerdict?: string; boardConfidence?: number;
  entries: ArenaEntryResult[]; artifactPath: string;
}

async function nextId(model: "comp" | "entry"): Promise<string> {
  if (model === "comp") {
    const rows = await db.arenaCompetition.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { competitionId: true } });
    let max = 0; for (const r of rows) { const m = r.competitionId.match(/^ARENA-(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); }
    return `ARENA-${(max + 1).toString().padStart(6, "0")}`;
  }
  const rows = await db.arenaEntry.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { entryId: true } });
  let max = 0; for (const r of rows) { const m = r.entryId.match(/^AE-(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `AE-${(max + 1).toString().padStart(6, "0")}`;
}

export interface RunCompetitionInput { mission: string; opportunityId?: string; potentialValue?: number; difficulty?: number; competition?: number; price?: number; projectId?: string }

export async function runCompetition(input: RunCompetitionInput): Promise<ArenaResult> {
  const competitionId = await nextId("comp");
  const opp = input.opportunityId ? await db.opportunity.findUnique({ where: { opportunityId: input.opportunityId } }) : null;
  const subject = opp?.title ?? input.mission;
  const base: BaseParams = {
    subject,
    potentialValue: num(opp?.potentialValue ?? input.potentialValue, 6),
    difficulty: num(opp?.difficulty ?? input.difficulty, 5),
    confidence: num(opp?.confidence, 55),
    competition: num(input.competition, 5),
    evidence: opp?.evidence ? (JSON.parse(opp.evidence) as { url?: string; snippet?: string }[]) : [],
    price: num(input.price, 30 + num(opp?.potentialValue ?? input.potentialValue, 6) * 10),
    opportunityId: opp?.opportunityId,
  };
  const mode = pickProvider() === "none" ? "HEURISTIC" : "MIXED";
  await db.arenaCompetition.create({ data: { competitionId, mission: input.mission, opportunityId: opp?.opportunityId ?? null, status: "RUNNING", mode } });
  await emit({ agent: "ARENA", action: "COMPETE_START", detail: `${competitionId}: 3 teams on "${subject.slice(0, 80)}"`, level: "INFO", category: "DECISION" });

  // Each team makes its bet and is scored by the real stack.
  const scored: (ArenaEntryResult & { totalRaw: number })[] = [];
  for (const t of TEAMS) {
    const s = t.transform(base);
    const positioning = t.positioning(subject);
    const simSubject = `${subject} — ${t.team}`;

    const v = await getAgent("VENTURE")!.execute({ goal: `arena ${t.team}: ${subject}`, context: { subject: simSubject, potentialValue: s.potentialValue, difficulty: s.difficulty, confidence: base.confidence, competition: s.competition, evidenceCount: base.evidence.length } });
    const vo = v.output as { ventureScore: number; growthPotential: number };
    const c = await getAgent("CUSTOMER")!.execute({ goal: `arena ${t.team}: ${subject}`, context: { subject: simSubject, potentialValue: s.potentialValue, difficulty: s.difficulty, competition: s.competition, personaCount: s.personaCount, price: s.price } });
    const co = c.output as { buyRate: number; customerRealityScore: number };

    // AEGIS: the team's market claim, weighted by how much it leans on existing proof.
    const truth = await assertClaim({
      statement: `[${t.team}] Market supports the "${t.focus}" strategy for "${subject}"`,
      subject: competitionId, category: "MARKET", source: `ARENA:${competitionId}:${t.team}`,
      evidence: base.evidence.slice(0, 6).map((e) => ({ stance: "SUPPORT" as const, summary: (e.snippet ?? e.url ?? "src").slice(0, 160), source: e.url ?? "opp-scan", sourceType: "WEB" as const, weight: 0.6 * s.evidenceWeight })),
      unknowns: [`${t.focus} strategy carries un-validated assumptions`],
    }).catch(() => null);

    const feasibility = clamp(100 - s.difficulty * 10);
    const risk = clamp(s.difficulty * 7 + s.competition * 3);
    const dims = {
      evidence: truth?.truthScore ?? 0,
      feasibility,
      customerValue: co.customerRealityScore,
      revenue: vo.ventureScore,
      risk: 100 - risk, // higher score = lower risk
      speed: clamp(100 - s.difficulty * 8),
      longTerm: vo.growthPotential,
    };
    const totalRaw = (Object.keys(W) as (keyof typeof W)[]).reduce((sum, k) => sum + dims[k] * W[k], 0);
    scored.push({
      entryId: "", team: t.team, focus: t.focus, positioning,
      ventureScore: vo.ventureScore, truthScore: truth?.truthScore ?? 0, customerReality: co.customerRealityScore, buyRate: co.buyRate,
      feasibility, risk, totalScore: clamp(Math.round(totalRaw)), rank: 0, verdict: "", breakdown: dims, totalRaw,
    });
    await emit({ agent: "ARENA", action: "TEAM_SCORED", detail: `${competitionId} ${t.team}: ${clamp(Math.round(totalRaw))}/100 (venture ${vo.ventureScore}, customer ${co.customerRealityScore})`, level: "INFO", category: "DECISION" });
  }

  // Judge: rank by total; winner = argmax. Deterministic tiebreak by team order.
  scored.sort((a, b) => b.totalRaw - a.totalRaw || TEAMS.findIndex((t) => t.team === a.team) - TEAMS.findIndex((t) => t.team === b.team));
  scored.forEach((e, i) => { e.rank = i + 1; e.verdict = i === 0 ? "WINNER" : i === 1 ? "RUNNER_UP" : "REJECTED"; });
  const winner = scored[0];
  const topDims = (Object.entries(winner.breakdown) as [string, number][]).sort((a, b) => b[1] * (W as Record<string, number>)[a[0]] - a[1] * (W as Record<string, number>)[b[0]]).slice(0, 3).map(([k]) => k);
  const rationale = `${winner.team} (${winner.focus}) wins at ${winner.totalScore}/100, led by ${topDims.join(", ")}. Runner-up ${scored[1].team} ${scored[1].totalScore}; rejected ${scored[2].team} ${scored[2].totalScore}.`;

  // Persist entries.
  for (const e of scored) {
    e.entryId = await nextId("entry");
    await db.arenaEntry.create({ data: {
      entryId: e.entryId, competitionId, team: e.team, focus: e.focus, positioning: e.positioning,
      strategy: JSON.stringify(TEAMS.find((t) => t.team === e.team)!.transform(base)),
      ventureScore: e.ventureScore, truthScore: e.truthScore, customerReality: e.customerReality, buyRate: e.buyRate,
      feasibility: e.feasibility, risk: e.risk, totalScore: e.totalScore, rank: e.rank, verdict: e.verdict,
      scoreBreakdown: JSON.stringify(e.breakdown),
    } });
  }

  // Board reviews the winning strategy (directive Phase 3).
  const board = await conveneBoard({
    topic: `Arena winner: ${winner.team} — ${subject}`,
    question: `Should Genesis back the ${winner.team} (${winner.focus}) strategy for "${subject}"?`,
    context: { ventureScore: winner.ventureScore, growthPotential: winner.breakdown.longTerm, competition: base.competition, truthScore: winner.truthScore, customerRealityScore: winner.customerReality, difficulty: base.difficulty },
    missionId: competitionId,
  }).catch(() => null);

  const artifactDir = path.resolve(workspaceRoot(), "arena", competitionId);
  await fs.mkdir(artifactDir, { recursive: true }).catch(() => {});
  const artifactPath = path.join(artifactDir, "ARENA_RESULT.md");
  await fs.writeFile(artifactPath, renderMarkdown(competitionId, input.mission, subject, mode, scored, rationale, board), "utf8").catch(() => {});

  await db.arenaCompetition.update({ where: { competitionId }, data: { status: "JUDGED", winnerTeam: winner.team, winnerScore: winner.totalScore, rationale, boardVerdict: board?.verdict ?? null, boardConfidence: board?.confidence ?? 0, artifactPath } });

  // Learning loop (directive Phase 4): winning pattern + failed strategies → memory (future G7 evolution).
  const mem = getMemoryEngine();
  await mem.record({ type: "SEMANTIC", title: `Arena winning pattern: ${winner.focus} for "${subject}" (${winner.totalScore})`, content: `${winner.team}/${winner.focus} won: ${winner.positioning} Scores — venture ${winner.ventureScore}, customer ${winner.customerReality}, truth ${winner.truthScore}. ${rationale}`, tags: ["arena", "winning-pattern", winner.focus], importance: 8, source: `ARENA:${competitionId}` });
  for (const loser of scored.slice(1)) {
    await mem.record({ type: "SEMANTIC", title: `Arena failed strategy: ${loser.focus} for "${subject}" (${loser.totalScore})`, content: `For "${subject}": ${loser.team}/${loser.focus} placed ${loser.rank}, lost to ${winner.focus} by ${winner.totalScore - loser.totalScore} pts.`, tags: ["arena", "failed-strategy", loser.focus], importance: 6, source: `ARENA:${competitionId}` });
  }

  await emit({ agent: "ARENA", action: "WINNER", detail: `${competitionId}: ${winner.team} wins ${winner.totalScore}/100 — ${rationale.slice(0, 90)}`, level: "SUCCESS", category: "DECISION" });

  return {
    competitionId, mission: input.mission, status: "JUDGED", mode,
    winnerTeam: winner.team, winnerScore: winner.totalScore, rationale,
    boardVerdict: board?.verdict, boardConfidence: board?.confidence,
    entries: scored.map(({ totalRaw: _totalRaw, ...e }) => e), artifactPath,
  };
}

function renderMarkdown(id: string, mission: string, subject: string, mode: string, entries: (ArenaEntryResult & { totalRaw: number })[], rationale: string, board: { verdict: string; confidence: number } | null): string {
  const banner = mode === "HEURISTIC" ? "> ⚠️ **HEURISTIC MODE** — teams' strategies are transparent parameter transforms scored by the rule-based stack; winner = argmax(score), not hardcoded.\n" : "> ℹ️ **MIXED MODE** — at least one scoring stage used the LLM provider.\n";
  const lines = [
    `# ARENA_RESULT — ${id}`, "", banner,
    `**Mission:** ${mission}  `, `**Subject:** ${subject}`, "",
    `## Judge verdict`, rationale, board ? `\n**Board review of winner:** ${board.verdict} (${board.confidence}%)` : "", "",
    `## Teams`, `| Rank | Team | Focus | Total | Venture | Customer | Truth | Feasibility | Risk | Verdict |`, `|---|---|---|---|---|---|---|---|---|---|`,
    ...entries.map((e) => `| ${e.rank} | ${e.team} | ${e.focus} | **${e.totalScore}** | ${e.ventureScore} | ${e.customerReality} | ${e.truthScore}% | ${e.feasibility} | ${e.risk} | ${e.verdict} |`),
    "", `## Strategic bets`,
    ...entries.map((e) => `- **${e.team}** — ${e.positioning}`),
  ];
  return lines.filter((l) => l !== "").join("\n");
}
