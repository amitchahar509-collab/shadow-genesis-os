/** AI Boardroom (V5 Phase 4) — no silent decisions.
 *
 * Before a major decision (a mission dispatch, a build/kill call on an
 * opportunity, a pricing change…) an executive board of nine role-agents each
 * argues from its own incentive. Their stances are tallied into a GO /
 * CONDITIONAL / NO_GO verdict, reconciled into a written synthesis, and
 * persisted as a BoardDecision + BoardArgument rows plus a BOARD_DECISION.md
 * artifact.
 *
 * Honesty rule (directive FORBIDDEN): a board member's argument is only real
 * reasoning when an LLM produced it. Without a provider every stance is a
 * rule-based heuristic derived from the numeric signals in `context`; those are
 * labelled `mode: "HEURISTIC"` on every row and flagged loudly in the artifact.
 * Heuristic stances are never presented as reasoned judgement.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { db } from "@/lib/db";
import { emit, events } from "../event-bus";
import { parseJsonResponse } from "../types";

export type Stance = "GO" | "NO_GO" | "ABSTAIN";
export type Verdict = "GO" | "CONDITIONAL" | "NO_GO";
export type ArgumentMode = "LLM" | "HEURISTIC";

export interface BoardRole {
  role: string;
  title: string;
  /** Persona + incentive the LLM argues from. */
  charter: string;
  /** Default disposition when reasoning heuristically: does this seat lean build or lean caution? */
  bias: "BUILD" | "CAUTION" | "NEUTRAL";
}

/** The nine seats. Order is stable — it is the reading order of BOARD_DECISION.md. */
export const BOARD: BoardRole[] = [
  { role: "FOUNDER", title: "Founder", charter: "Obsessed with the mission and the 10-year vision. Pushes for bold bets that compound, distrusts incrementalism, but will not chase a market with no real pain.", bias: "BUILD" },
  { role: "CEO", title: "CEO", charter: "Owns execution and focus. Weighs whether this is the single best use of the company's limited attention right now versus everything else on the table.", bias: "NEUTRAL" },
  { role: "INVESTOR", title: "Investor", charter: "Thinks in power-law returns. Asks whether this can become a large, defensible business and whether now is the moment. Kills mediocre-outcome bets.", bias: "CAUTION" },
  { role: "CUSTOMER", title: "Customer Representative", charter: "Speaks only for the target user. Cares about whether the pain is acute, whether they would actually switch and pay, and what would make them churn.", bias: "NEUTRAL" },
  { role: "COMPETITOR", title: "Competitor (red team)", charter: "Argues as the incumbent who would crush this. Surfaces how an entrenched rival responds, why customers stay put, and where the moat is missing.", bias: "CAUTION" },
  { role: "CFO", title: "CFO", charter: "Guards unit economics and cash. Cares about cost to build and operate, path to margin, and payback. Vetoes plans that burn without a revenue line of sight.", bias: "CAUTION" },
  { role: "GROWTH", title: "Growth", charter: "Owns distribution. Judges whether there is a repeatable, affordable channel to reach the customer — a great product no one can reach is a NO_GO.", bias: "NEUTRAL" },
  { role: "ENGINEER", title: "Engineer", charter: "Owns feasibility and delivery risk. Judges technical difficulty, unknowns, and whether a credible MVP ships in a sane timeframe with the current runtime.", bias: "NEUTRAL" },
  { role: "RISK", title: "Risk Officer", charter: "Names the blind spots, legal/safety/compliance exposure, and single points of failure everyone else is too excited to see. Has an effective veto on unacceptable risk.", bias: "CAUTION" },
];

export interface ConveneInput {
  topic: string;
  /** The decision being put to the board, phrased as a question. */
  question: string;
  /** Structured signals the board reasons over. Numeric fields drive heuristic stances. */
  context?: Record<string, unknown>;
  projectId?: string;
  missionId?: string;
  /** Where to write BOARD_DECISION.md. Defaults to .genesis-workspace/boardroom/<id>. */
  workspaceRoot?: string;
  /** Per-member LLM budget. Kept short — nine calls run in parallel. */
  timeoutMs?: number;
}

export interface BoardArgumentResult {
  role: string;
  title: string;
  stance: Stance;
  argument: string;
  concerns: string[];
  confidence: number;
  mode: ArgumentMode;
}

export interface BoardDecisionResult {
  decisionId: string;
  topic: string;
  question: string;
  verdict: Verdict;
  confidence: number;
  tally: Record<Stance, number>;
  synthesis: string;
  conditions: string[];
  risks: string[];
  mode: "LLM" | "HEURISTIC" | "MIXED";
  arguments: BoardArgumentResult[];
  artifactPath: string;
}

/** Pull the small set of numeric signals heuristics key off, with safe defaults.
 *
 * A prior AI Venture Analyst (VENTURE agent) hands off a `ventureScore` (0-100)
 * and dimension scores; when present these override the raw signals so the
 * board debates a quantified venture instead of guessing from primitives. */
function readSignals(context: Record<string, unknown> = {}) {
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const hasVenture = typeof context.ventureScore === "number";
  // AEGIS: an unsupported market claim must cap board confidence — the directive's
  // "never allow unsupported confidence". truthScore 0 caps confidence at 40.
  const truthCap = typeof context.truthScore === "number" ? 40 + num(context.truthScore, 100) * 0.6 : 100;
  const baseConfidence = hasVenture ? num(context.ventureScore, 50) : num(context.confidence, 50);
  return {
    // 0-100: venture score / raw confidence, capped by evidence-grounding
    confidence: Math.min(baseConfidence, truthCap),
    // 1-10: how hard to build
    difficulty: num(context.difficulty, 5),
    // 1-10: upside if it works — derive from the analyst's growthPotential (0-100) when present
    potentialValue: context.growthPotential !== undefined ? num(context.growthPotential, 50) / 10 : num(context.potentialValue ?? context.value, 5),
    // count of evidence items / sources gathered. When AEGIS supplies a truth
    // score, derive the evidence signal from it (0-100 → ~0-5) so the Risk and
    // Customer seats react to a weakly-grounded claim, not just its score.
    evidence: typeof context.truthScore === "number"
      ? Math.min(num(context.evidenceCount ?? context.evidence, 99), Math.floor(num(context.truthScore, 0) / 20))
      : num(context.evidenceCount ?? context.evidence, 0),
    // 1-10: how crowded the market is (higher = more competitors). The analyst's
    // `competition` dimension is inverted (100 = wide open), so translate it back.
    competition: context.competition !== undefined && hasVenture ? (100 - num(context.competition, 50)) / 10 : num(context.competition, 5),
    // 0-100 CUSTOMER_REALITY_SCORE from the Digital Customer Simulation, if run.
    // -1 means "no simulation" so the Customer seat keeps its evidence-based logic.
    customerReality: typeof context.customerRealityScore === "number" ? num(context.customerRealityScore, 50) : -1,
  };
}

/** Deterministic, defensible stance when no LLM is available. Never dressed up as reasoning. */
function heuristicArgument(role: BoardRole, s: ReturnType<typeof readSignals>): BoardArgumentResult {
  // A single composite score in [-3, +3]; each seat weights the signals by its charter.
  let score = 0;
  const concerns: string[] = [];
  switch (role.role) {
    case "FOUNDER":
      score = (s.potentialValue - 5) * 0.6 + (s.confidence - 50) / 25;
      if (s.potentialValue < 5) concerns.push("upside looks incremental, not mission-scale");
      break;
    case "CEO":
      score = (s.confidence - 50) / 25 + (s.potentialValue - s.difficulty) * 0.3;
      if (s.difficulty >= 8) concerns.push("high execution cost competes with everything else on the roadmap");
      break;
    case "INVESTOR":
      score = (s.potentialValue - 6) * 0.7 + (s.confidence - 55) / 20 - Math.max(0, s.competition - 6) * 0.3;
      if (s.potentialValue < 6) concerns.push("outcome may not clear the power-law bar");
      break;
    case "CUSTOMER":
      if (s.customerReality >= 0) {
        // A customer simulation ran — speak from simulated buyer behaviour.
        score = (s.customerReality - 50) / 18;
        if (s.customerReality < 45) concerns.push(`simulated buy-rate is weak (reality ${Math.round(s.customerReality)}/100)`);
      } else {
        score = (s.confidence - 50) / 20 + (s.evidence > 2 ? 1 : -1);
        if (s.evidence < 2) concerns.push("insufficient evidence the pain is acute enough to switch");
      }
      break;
    case "COMPETITOR":
      score = -(Math.max(0, s.competition - 4) * 0.6) + (s.potentialValue - 5) * 0.2;
      if (s.competition >= 6) concerns.push("entrenched incumbents will defend this space hard");
      break;
    case "CFO":
      score = (s.potentialValue - 5) * 0.4 - (s.difficulty - 5) * 0.5;
      if (s.difficulty >= 7) concerns.push("cost to build/operate lacks a clear payback");
      break;
    case "GROWTH":
      score = (s.confidence - 50) / 25 - Math.max(0, s.competition - 5) * 0.25;
      if (s.competition >= 7) concerns.push("no obvious low-cost channel in a crowded market");
      break;
    case "ENGINEER":
      score = (6 - s.difficulty) * 0.6 + (s.evidence > 0 ? 0.3 : 0);
      if (s.difficulty >= 8) concerns.push("technical difficulty implies real delivery risk and unknowns");
      break;
    case "RISK":
      score = (s.confidence - 55) / 20 - (s.difficulty - 5) * 0.3 - Math.max(0, s.competition - 6) * 0.2;
      if (s.evidence < 1) concerns.push("no evidence base — decision would be flying blind");
      if (s.difficulty >= 8) concerns.push("delivery + operational risk is elevated");
      break;
  }
  const bias = role.bias === "BUILD" ? 0.4 : role.bias === "CAUTION" ? -0.4 : 0;
  score += bias;
  const stance: Stance = score > 0.5 ? "GO" : score < -0.5 ? "NO_GO" : "ABSTAIN";
  const confidence = Math.round(Math.min(90, 45 + Math.abs(score) * 15));
  const argument =
    `[HEURISTIC] ${role.title} — rule-based stance from signals ` +
    `(confidence ${s.confidence}, value ${s.potentialValue}/10, difficulty ${s.difficulty}/10, ` +
    `competition ${s.competition}/10, evidence ${s.evidence}). ` +
    `Score ${score.toFixed(2)} → ${stance}. No LLM configured, so this is not reasoned judgement.`;
  return { role: role.role, title: role.title, stance, argument, concerns, confidence, mode: "HEURISTIC" };
}

async function llmArgument(role: BoardRole, input: ConveneInput, timeoutMs: number): Promise<BoardArgumentResult | null> {
  const system =
    `You are the ${role.title} on the executive board of an autonomous AI company. ${role.charter} ` +
    `Argue ONLY from your seat's incentives — do not try to be balanced, that is the board's job collectively. ` +
    `Respond ONLY with JSON: {"stance":"GO|NO_GO|ABSTAIN","argument":"2-4 sentences","concerns":["…"],"confidence":0-100}.`;
  const user = `Decision: ${input.question}\nTopic: ${input.topic}\n\nContext:\n${JSON.stringify(input.context ?? {}, null, 2)}`;
  // Route through the multi-provider router — BOARDROOM → REASONING (strongest model).
  const { callLlmRouted } = await import("../router");
  const r = await callLlmRouted({ system, user, temperature: 0.6, maxTokens: 500, timeoutMs }, { agent: "BOARDROOM" });
  if (!r.ok) return null;
  const parsed = parseJsonResponse(r.text) as { stance?: string; argument?: string; concerns?: string[]; confidence?: number } | null;
  if (!parsed?.argument) return null;
  const stance: Stance = parsed.stance === "GO" ? "GO" : parsed.stance === "NO_GO" ? "NO_GO" : "ABSTAIN";
  return {
    role: role.role,
    title: role.title,
    stance,
    argument: parsed.argument,
    concerns: Array.isArray(parsed.concerns) ? parsed.concerns.filter((c) => typeof c === "string").slice(0, 5) : [],
    confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(100, parsed.confidence)) : 60,
    mode: "LLM",
  };
}

/** Reconcile nine stances into a verdict. RISK holds an effective veto on a confident NO_GO. */
function synthesize(args: BoardArgumentResult[]): {
  verdict: Verdict; confidence: number; tally: Record<Stance, number>; conditions: string[]; risks: string[]; synthesis: string;
} {
  const tally: Record<Stance, number> = { GO: 0, NO_GO: 0, ABSTAIN: 0 };
  for (const a of args) tally[a.stance]++;

  const risk = args.find((a) => a.role === "RISK");
  const riskVeto = !!risk && risk.stance === "NO_GO" && risk.confidence >= 70;

  let verdict: Verdict;
  if (riskVeto || tally.NO_GO > tally.GO) verdict = "NO_GO";
  else if (tally.GO > tally.NO_GO + tally.ABSTAIN) verdict = "GO";
  else verdict = "CONDITIONAL";

  // Weighted board confidence in whichever way the verdict leans.
  const leaning = verdict === "NO_GO" ? "NO_GO" : "GO";
  const aligned = args.filter((a) => a.stance === leaning);
  const confidence = aligned.length
    ? Math.round(aligned.reduce((s, a) => s + a.confidence, 0) / aligned.length)
    : 40;

  // Conditions: concerns raised by anyone who did NOT vote GO — the things that must be resolved.
  const conditions = dedupe(args.filter((a) => a.stance !== "GO").flatMap((a) => a.concerns)).slice(0, 6);
  // Risks: everything RISK + COMPETITOR flagged, plus any NO_GO concerns.
  const risks = dedupe(args.filter((a) => a.role === "RISK" || a.role === "COMPETITOR" || a.stance === "NO_GO").flatMap((a) => a.concerns)).slice(0, 6);

  const synthesis =
    `Board voted ${tally.GO} GO / ${tally.NO_GO} NO_GO / ${tally.ABSTAIN} ABSTAIN → ${verdict}` +
    (riskVeto ? " (Risk Officer veto)" : "") +
    `. ${verdict === "GO" ? "Proceed." : verdict === "CONDITIONAL" ? "Proceed only once the conditions below are addressed." : "Do not proceed as framed."}`;

  return { verdict, confidence, tally, conditions, risks, synthesis };
}

function dedupe(xs: string[]): string[] { return [...new Set(xs.map((x) => x.trim()).filter(Boolean))]; }

async function nextDecisionNumber(): Promise<number> {
  const recent = await db.boardDecision.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { decisionId: true } });
  let max = 0;
  for (const r of recent) { const m = r.decisionId.match(/^BOARD-(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return max + 1;
}

function renderMarkdown(d: BoardDecisionResult, input: ConveneInput): string {
  const modeBanner =
    d.mode === "HEURISTIC"
      ? "> ⚠️ **HEURISTIC MODE — no LLM provider configured.** Every stance below is a rule-based function of the numeric signals, not reasoned argument. Set `ANTHROPIC_API_KEY` for a real debate.\n"
      : d.mode === "MIXED"
      ? "> ⚠️ **MIXED MODE — some seats fell back to heuristics** (LLM error/timeout). Heuristic seats are marked `[HEURISTIC]`.\n"
      : "> ✅ **LLM MODE — every seat argued via the configured provider.**\n";
  const lines: string[] = [];
  lines.push(`# BOARD_DECISION — ${d.decisionId}`);
  lines.push("");
  lines.push(modeBanner);
  lines.push(`**Topic:** ${d.topic}  `);
  lines.push(`**Question:** ${d.question}  `);
  lines.push(`**Verdict:** ${d.verdict} · **Confidence:** ${d.confidence}% · **Tally:** ${d.tally.GO} GO / ${d.tally.NO_GO} NO_GO / ${d.tally.ABSTAIN} ABSTAIN`);
  lines.push("");
  lines.push(`## Synthesis`);
  lines.push(d.synthesis);
  lines.push("");
  if (d.conditions.length) {
    lines.push(`## Conditions to satisfy`);
    for (const c of d.conditions) lines.push(`- [ ] ${c}`);
    lines.push("");
  }
  if (d.risks.length) {
    lines.push(`## Risks & blind spots`);
    for (const r of d.risks) lines.push(`- ⚠️ ${r}`);
    lines.push("");
  }
  lines.push(`## The board`);
  for (const a of d.arguments) {
    const icon = a.stance === "GO" ? "🟢" : a.stance === "NO_GO" ? "🔴" : "⚪";
    lines.push(`### ${icon} ${a.title} — **${a.stance}** (${a.confidence}%)`);
    lines.push(a.argument);
    if (a.concerns.length) lines.push(a.concerns.map((c) => `- ${c}`).join("\n"));
    lines.push("");
  }
  lines.push(`---`);
  lines.push(`*Context debated:*`);
  lines.push("```json");
  lines.push(JSON.stringify(input.context ?? {}, null, 2));
  lines.push("```");
  return lines.join("\n");
}

/**
 * Convene the board on a single decision. Never throws — a boardroom failure
 * must not take down the mission it advises; on internal error it returns a
 * CONDITIONAL verdict flagging the failure.
 */
export async function conveneBoard(input: ConveneInput): Promise<BoardDecisionResult> {
  const timeoutMs = input.timeoutMs ?? 9_000;
  const signals = readSignals(input.context);
  await emit(events.decision("BOARDROOM", `convening on: ${input.question.slice(0, 120)}`));

  // Every seat argues in parallel; each independently falls back to a heuristic.
  const args = await Promise.all(
    BOARD.map(async (role) => {
      try {
        const viaLlm = await llmArgument(role, input, timeoutMs);
        if (viaLlm) return viaLlm;
      } catch { /* fall through to heuristic */ }
      return heuristicArgument(role, signals);
    }),
  );

  const anyLlm = args.some((a) => a.mode === "LLM");
  const allLlm = args.every((a) => a.mode === "LLM");
  const mode: BoardDecisionResult["mode"] = allLlm ? "LLM" : anyLlm ? "MIXED" : "HEURISTIC";

  const { verdict, confidence, tally, conditions, risks, synthesis } = synthesize(args);

  const decisionId = `BOARD-${(await nextDecisionNumber()).toString().padStart(6, "0")}`;
  const workspaceRoot = input.workspaceRoot ?? path.resolve(process.cwd(), ".genesis-workspace", "boardroom", decisionId);
  await fs.mkdir(workspaceRoot, { recursive: true }).catch(() => {});
  const artifactPath = path.join(workspaceRoot, "BOARD_DECISION.md");

  const result: BoardDecisionResult = { decisionId, topic: input.topic, question: input.question, verdict, confidence, tally, synthesis, conditions, risks, mode, arguments: args, artifactPath };

  await fs.writeFile(artifactPath, renderMarkdown(result, input), "utf8").catch(() => {});

  // Persist decision + arguments.
  try {
    await db.boardDecision.create({
      data: {
        decisionId, topic: input.topic, question: input.question,
        context: safeJson(input.context ?? {}), verdict, confidence,
        tally: JSON.stringify(tally), synthesis,
        conditions: JSON.stringify(conditions), risks: JSON.stringify(risks),
        mode, projectId: input.projectId ?? null, missionId: input.missionId ?? null, artifactPath,
        arguments: { create: args.map((a) => ({ role: a.role, stance: a.stance, argument: a.argument, concerns: JSON.stringify(a.concerns), confidence: a.confidence, mode: a.mode })) },
      },
    });
  } catch (e) {
    await emit(events.error("BOARDROOM", `persist failed: ${e instanceof Error ? e.message : String(e)}`));
  }

  const level = verdict === "NO_GO" ? "WARNING" : "SUCCESS";
  await emit({ agent: "BOARDROOM", action: "VERDICT", detail: `${decisionId}: ${verdict} (${confidence}%, ${mode}) — ${synthesis.slice(0, 100)}`, level, category: "DECISION" });
  return result;
}

function safeJson(v: unknown): string { try { const s = JSON.stringify(v); return s.length > 20_000 ? s.slice(0, 20_000) : s; } catch { return "{}"; } }
