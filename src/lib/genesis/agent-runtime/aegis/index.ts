/** AEGIS Truth Engine (V6 Phase 1) — never allow unsupported confidence.
 *
 * Every material claim Genesis relies on (market demand, competition, timing,
 * feasibility…) is recorded with its evidence, split into support / contradict /
 * neutral, weighted by source reliability. From that ledger AEGIS computes a
 * truth score and a verdict — SUPPORTED / CONTESTED / UNSUPPORTED — that
 * downstream agents (Venture Analyst, Boardroom, CEO) consult before acting.
 *
 * Core honesty invariant (directive FORBIDDEN: never fake evidence): a claim
 * with **no evidence scores 0 and is UNSUPPORTED**, no matter how confident the
 * asserting agent felt. Evidence provenance (`sourceType`) is always recorded,
 * so COMPUTED signals can never be laundered into WEB-verified fact.
 */

import { db } from "@/lib/db";
import { emit, events } from "../event-bus";

export type EvidenceStance = "SUPPORT" | "CONTRADICT" | "NEUTRAL";
export type SourceType = "WEB" | "MEMORY" | "COMPUTED" | "USER" | "SIMULATION" | "UNKNOWN";
export type Verdict = "SUPPORTED" | "CONTESTED" | "UNSUPPORTED";

export interface EvidenceInput {
  stance: EvidenceStance;
  summary: string;
  source: string;
  sourceType?: SourceType;
  weight?: number; // 0-1
}

export interface AssertClaimInput {
  statement: string;
  subject?: string;
  category?: "MARKET" | "DEMAND" | "COMPETITION" | "FEASIBILITY" | "TIMING" | "FINANCIAL" | "OTHER";
  source?: string;
  evidence?: EvidenceInput[];
  unknowns?: string[];
}

export interface TruthResult {
  claimId: string;
  statement: string;
  truthScore: number; // 0-100
  verdict: Verdict;
  supportCount: number;
  contradictCount: number;
  unknowns: string[];
}

const clampWeight = (w: number | undefined) => Math.max(0, Math.min(1, typeof w === "number" && Number.isFinite(w) ? w : 1));

/**
 * Score a claim from its evidence. The invariant lives here:
 *   - no evidence            → truthScore 0, UNSUPPORTED
 *   - support outweighs doubt → scales toward SUPPORTED, but volume-damped so a
 *     single weak source can't reach high confidence
 *   - meaningful contradiction → CONTESTED regardless of support
 */
export function scoreEvidence(evidence: EvidenceInput[]): { truthScore: number; verdict: Verdict; supportCount: number; contradictCount: number } {
  const support = evidence.filter((e) => e.stance === "SUPPORT");
  const contradict = evidence.filter((e) => e.stance === "CONTRADICT");
  const supportCount = support.length;
  const contradictCount = contradict.length;

  if (supportCount === 0 && contradictCount === 0) {
    return { truthScore: 0, verdict: "UNSUPPORTED", supportCount, contradictCount };
  }

  const supportW = support.reduce((s, e) => s + clampWeight(e.weight), 0);
  const contradictW = contradict.reduce((s, e) => s + clampWeight(e.weight), 0);

  // Net support, damped by a prior (k) so low-volume evidence cannot reach high
  // confidence, and contradictions bite harder than they help.
  const k = 2;
  const raw = (supportW - contradictW * 1.5) / (supportW + contradictW + k);
  const truthScore = Math.max(0, Math.min(100, Math.round(raw * 100)));

  let verdict: Verdict;
  if (contradictW >= supportW * 0.5 && contradictCount > 0) verdict = "CONTESTED";
  else if (truthScore >= 60) verdict = "SUPPORTED";
  else if (truthScore >= 25) verdict = "CONTESTED";
  else verdict = "UNSUPPORTED";

  return { truthScore, verdict, supportCount, contradictCount };
}

const pad = (n: number) => n.toString().padStart(6, "0");

async function nextClaimNumber(): Promise<number> {
  const rows = await db.claim.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { claimId: true } });
  let max = 0;
  for (const r of rows) { const m = r.claimId.match(/^CLM-(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return max + 1;
}

async function nextEvidenceNumber(): Promise<number> {
  const rows = await db.evidence.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { evidenceId: true } });
  let max = 0;
  for (const r of rows) { const m = r.evidenceId.match(/^EV-(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return max + 1;
}

/** Record a claim + its evidence and compute its truth. Never throws for the caller's benefit. */
export async function assertClaim(input: AssertClaimInput): Promise<TruthResult> {
  const evidence = input.evidence ?? [];
  const { truthScore, verdict, supportCount, contradictCount } = scoreEvidence(evidence);
  const unknowns = input.unknowns ?? [];
  // Numeric-id allocation can collide under concurrent asserts — retry on P2002
  // by re-reading the max (same pattern as AgentExecution id allocation).
  let claimId = "";
  for (let attempt = 0; ; attempt++) {
    claimId = `CLM-${pad(await nextClaimNumber())}`;
    const evBase = await nextEvidenceNumber();
    try {
      await db.claim.create({
        data: {
          claimId, statement: input.statement, subject: input.subject ?? null,
          category: input.category ?? "MARKET", truthScore, verdict,
          supportCount, contradictCount, unknowns: JSON.stringify(unknowns), source: input.source ?? null,
          evidence: {
            create: evidence.map((e, i) => ({
              evidenceId: `EV-${pad(evBase + i)}`,
              stance: e.stance, summary: e.summary, source: e.source,
              sourceType: e.sourceType ?? "UNKNOWN", weight: clampWeight(e.weight),
            })),
          },
        },
      });
      break;
    } catch (e) {
      if ((e as { code?: string })?.code !== "P2002" || attempt >= 4) throw e;
    }
  }

  await emit({
    agent: "AEGIS", action: "CLAIM",
    detail: `${claimId}: "${input.statement.slice(0, 80)}" → ${verdict} (${truthScore}%, ${supportCount}↑/${contradictCount}↓)`,
    level: verdict === "UNSUPPORTED" ? "WARNING" : "INFO", category: "RESEARCH",
  });

  return { claimId, statement: input.statement, truthScore, verdict, supportCount, contradictCount, unknowns };
}

/** Aggregate truth over every claim on a subject — the evidence-grounding of a decision. */
export async function verifySubject(subject: string): Promise<{ subject: string; overallTruth: number; verdict: Verdict; claims: number; contested: number; unsupported: number }> {
  const claims = await db.claim.findMany({ where: { subject } });
  if (!claims.length) return { subject, overallTruth: 0, verdict: "UNSUPPORTED", claims: 0, contested: 0, unsupported: 0 };
  const overallTruth = Math.round(claims.reduce((s, c) => s + c.truthScore, 0) / claims.length);
  const contested = claims.filter((c) => c.verdict === "CONTESTED").length;
  const unsupported = claims.filter((c) => c.verdict === "UNSUPPORTED").length;
  const verdict: Verdict = unsupported > claims.length / 2 ? "UNSUPPORTED" : contested > 0 ? "CONTESTED" : overallTruth >= 60 ? "SUPPORTED" : "CONTESTED";
  return { subject, overallTruth, verdict, claims: claims.length, contested, unsupported };
}

/** Claims on a subject that carry recorded contradictions — the board's blind-spot list. */
export async function contradictions(subject: string) {
  return db.claim.findMany({ where: { subject, contradictCount: { gt: 0 } }, include: { evidence: { where: { stance: "CONTRADICT" } } } });
}
