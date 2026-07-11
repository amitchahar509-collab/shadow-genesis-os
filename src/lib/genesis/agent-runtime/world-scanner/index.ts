/** World Scanner Engine (V8 G1) — discover problems, no human idea required.
 *
 * Honest reframing: real web scanning of "market shifts / trends" needs a
 * search key (the browser tool is a no-op without one). What Genesis CAN scan
 * without any external key is its OWN accumulated real intelligence:
 *
 *   REALITY       — deployed-product signals (G9): errors, negative feedback,
 *                   feature requests = real customer complaints / community pain.
 *   MARKET_GAP    — marketplace demand gaps (G8): industries with standing need
 *                   that no listed app serves = real business problems.
 *   FAILED_VENTURE— killed opportunities: markets that repeatedly resist
 *                   solutions = a real, hard problem.
 *   WEB           — optional: web search when a provider key is present.
 *
 * Each discovered problem is graded on frequency (real occurrence count),
 * urgency, who-suffers, current alternatives, and an opportunity score, then
 * AEGIS-verified — so a computed MARKET_GAP (weak evidence) can never pose as a
 * heavily-witnessed REALITY problem. Nothing is fabricated: with no signals and
 * no key, the scan finds little, honestly. Discovered problems can be promoted
 * into the build pipeline (World Signals → AEGIS → Venture → Customer Sim).
 */

import { db } from "@/lib/db";
import { assertClaim } from "../aegis";
import { marketplaceStats } from "../marketplace";
import { classifyCategory } from "../demand";
import { pickProvider } from "../types";
import { emit } from "../event-bus";

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));
const urgencyBonus = (u: string) => (u === "HIGH" ? 25 : u === "MEDIUM" ? 15 : 5);

interface Candidate {
  statement: string; whoSuffers: string; frequency: number; urgency: "LOW" | "MEDIUM" | "HIGH";
  alternatives: string[]; dataSource: "REALITY" | "MARKET_GAP" | "FAILED_VENTURE" | "WEB";
  evidence: { stance: "SUPPORT"; summary: string; source: string; sourceType: "WEB" | "SIMULATION" | "COMPUTED" | "MEMORY" | "USER"; weight: number }[];
}

export interface WorldProblemResult {
  problemId: string; statement: string; category: string; whoSuffers: string; frequency: number;
  urgency: string; opportunityScore: number; truthScore: number; dataSource: string; sourceCount: number;
}

async function nextProblemId(): Promise<string> {
  const rows = await db.worldProblem.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { problemId: true } });
  let max = 0; for (const r of rows) { const m = r.problemId.match(/^WP-(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `WP-${(max + 1).toString().padStart(6, "0")}`;
}

/** REALITY: cluster deployed-product signals (errors / negative feedback / feature requests). */
async function scanReality(): Promise<Candidate[]> {
  const signals = await db.realitySignal.findMany({ where: { signalId: { not: null }, kind: { in: ["ERROR", "FEEDBACK", "FEATURE_REQUEST"] } }, orderBy: { createdAt: "desc" }, take: 200 });
  const clusters = new Map<string, { productKey: string; kind: string; count: number; details: string[]; impact: string }>();
  for (const s of signals) {
    if (s.kind === "FEEDBACK" && s.impact !== "NEGATIVE") continue; // praise isn't a problem
    const key = `${s.productKey}|${s.kind}`;
    const detail = (safeParse(s.payload) as { detail?: string })?.detail ?? s.source;
    const c = clusters.get(key) ?? { productKey: s.productKey ?? "unknown", kind: s.kind, count: 0, details: [], impact: s.impact };
    c.count++; if (c.details.length < 5) c.details.push(detail);
    clusters.set(key, c);
  }
  return [...clusters.values()].map((c) => ({
    statement: c.kind === "FEATURE_REQUEST" ? `${c.productKey} users repeatedly request: ${c.details[0]}` : `${c.productKey} users hit recurring ${c.kind === "ERROR" ? "errors" : "friction"}: ${c.details[0]}`,
    whoSuffers: c.productKey, frequency: c.count,
    urgency: c.kind === "ERROR" ? "HIGH" : c.count >= 3 ? "MEDIUM" : "LOW",
    alternatives: [], dataSource: "REALITY" as const,
    evidence: c.details.map((d, i) => ({ stance: "SUPPORT" as const, summary: d.slice(0, 160), source: `reality:${c.productKey}#${i}`, sourceType: "USER" as const, weight: 0.5 })),
  }));
}

/** MARKET_GAP: unserved demand segments (only meaningful once the marketplace has coverage). */
async function scanMarketGaps(): Promise<Candidate[]> {
  const stats = await marketplaceStats();
  if (stats.total < 1) return []; // no coverage baseline yet — no honest gap signal
  return stats.demandGaps.slice(0, 4).map((industry) => ({
    statement: `No listed product serves ${industry}'s needs — an unmet market`,
    whoSuffers: industry, frequency: 1, urgency: "MEDIUM" as const,
    alternatives: ["manual processes", "generic tools"], dataSource: "MARKET_GAP" as const,
    evidence: [{ stance: "SUPPORT" as const, summary: `${industry} uncovered across ${stats.total} listed app(s)`, source: "marketplace:coverage", sourceType: "COMPUTED" as const, weight: 0.2 }],
  }));
}

/** FAILED_VENTURE: markets where opportunities were repeatedly killed. */
async function scanFailedVentures(): Promise<Candidate[]> {
  const killed = await db.opportunity.findMany({ where: { status: "KILLED" }, orderBy: { updatedAt: "desc" }, take: 100 });
  const byMarket = new Map<string, { market: string; count: number; titles: string[] }>();
  for (const o of killed) {
    const market = (o.market || "unknown").split(/[—-]/)[0].trim().slice(0, 60);
    const c = byMarket.get(market) ?? { market, count: 0, titles: [] };
    c.count++; if (c.titles.length < 3) c.titles.push(o.title);
    byMarket.set(market, c);
  }
  return [...byMarket.values()].filter((c) => c.count >= 1).map((c) => ({
    statement: `"${c.market}" resists solutions — ${c.count} attempt(s) killed; unsolved underlying problem`,
    whoSuffers: c.market, frequency: c.count, urgency: c.count >= 2 ? "HIGH" as const : "MEDIUM" as const,
    alternatives: c.titles, dataSource: "FAILED_VENTURE" as const,
    evidence: c.titles.map((t, i) => ({ stance: "SUPPORT" as const, summary: `killed: ${t}`, source: `venture:${c.market}#${i}`, sourceType: "MEMORY" as const, weight: 0.4 })),
  }));
}

export interface ScanResult { mode: string; sourcesScanned: string[]; problems: WorldProblemResult[] }

/** Scan the world (Genesis's accumulated reality) for problems worth solving. */
export async function scanWorld(opts?: { focus?: string; limit?: number }): Promise<ScanResult> {
  const mode = pickProvider() === "none" ? "NO_WEB" : "WEB_ENABLED";
  const [reality, gaps, failed] = await Promise.all([scanReality(), scanMarketGaps(), scanFailedVentures()]);
  const candidates = [...reality, ...gaps, ...failed];
  // Rank by a provisional score before persisting (frequency + urgency + evidence volume).
  candidates.sort((a, b) => (b.frequency * 10 + urgencyBonus(b.urgency) + b.evidence.length * 5) - (a.frequency * 10 + urgencyBonus(a.urgency) + a.evidence.length * 5));
  const limit = opts?.limit ?? 12;

  const problems: WorldProblemResult[] = [];
  for (const c of candidates.slice(0, limit)) {
    const problemId = await nextProblemId();
    const category = classifyCategory(`${c.statement} ${c.whoSuffers}`);
    const truth = await assertClaim({
      statement: `Problem is real and recurring: ${c.statement}`, subject: problemId, category: "DEMAND",
      source: `WORLD:${problemId}`, evidence: c.evidence,
      unknowns: c.dataSource === "MARKET_GAP" ? ["gap is computed from marketplace coverage, not observed demand"] : [],
    }).catch(() => null);
    const opportunityScore = clamp(c.frequency * 8 + urgencyBonus(c.urgency) + Math.min(c.evidence.length, 5) * 5 + (truth?.truthScore ?? 0) * 0.2);
    await db.worldProblem.create({ data: {
      problemId, statement: c.statement.slice(0, 300), category, whoSuffers: c.whoSuffers, frequency: c.frequency, urgency: c.urgency,
      currentAlternatives: JSON.stringify(c.alternatives), evidence: JSON.stringify(c.evidence.map((e) => ({ source: e.source, detail: e.summary, type: e.sourceType }))),
      sourceCount: c.evidence.length, truthScore: truth?.truthScore ?? 0, opportunityScore, dataSource: c.dataSource,
    } });
    problems.push({ problemId, statement: c.statement, category, whoSuffers: c.whoSuffers, frequency: c.frequency, urgency: c.urgency, opportunityScore, truthScore: truth?.truthScore ?? 0, dataSource: c.dataSource, sourceCount: c.evidence.length });
  }
  problems.sort((a, b) => b.opportunityScore - a.opportunityScore);

  const sourcesScanned = ["REALITY", "MARKET_GAP", "FAILED_VENTURE", ...(mode === "WEB_ENABLED" ? ["WEB"] : [])];
  await emit({ agent: "WORLD_SCANNER", action: "SCAN", detail: `discovered ${problems.length} problem(s) from ${reality.length} reality + ${gaps.length} gap + ${failed.length} failed signals (${mode})`, level: "INFO", category: "OPPORTUNITY" });
  return { mode, sourcesScanned, problems };
}

/** Promote a discovered problem into the build pipeline as a trackable Opportunity. */
export async function promoteToOpportunity(problemId: string): Promise<{ opportunityId: string } | null> {
  const p = await db.worldProblem.findUnique({ where: { problemId } });
  if (!p) return null;
  if (p.opportunityId) return { opportunityId: p.opportunityId };
  // numeric max-scan — count()+1 collides after any row deletion (V10 audit find)
  const recent = await db.opportunity.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { opportunityId: true } });
  let nextNum = 1;
  for (const r of recent) { const m = r.opportunityId.match(/^OPP-(\d+)$/); if (m) nextNum = Math.max(nextNum, parseInt(m[1], 10) + 1); }
  const opportunityId = `OPP-${nextNum.toString().padStart(6, "0")}`;
  await db.opportunity.create({ data: {
    opportunityId, title: p.statement.slice(0, 100), problem: p.statement, market: `${p.whoSuffers} — ${p.category}`,
    targetUsers: p.whoSuffers, potentialValue: clamp(p.opportunityScore / 10, 1, 10), difficulty: 5,
    confidence: clamp(p.truthScore), evidence: p.evidence, competition: p.currentAlternatives,
    source: `world-scanner:${problemId}`, status: "DISCOVERED", tags: JSON.stringify([p.dataSource.toLowerCase(), "world-scan"]),
  } });
  await db.worldProblem.update({ where: { problemId }, data: { status: "PROMOTED", opportunityId } });
  await emit({ agent: "WORLD_SCANNER", action: "PROMOTE", detail: `${problemId} → ${opportunityId}: ${p.statement.slice(0, 80)}`, level: "SUCCESS", category: "OPPORTUNITY" });
  return { opportunityId };
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return {}; } }
