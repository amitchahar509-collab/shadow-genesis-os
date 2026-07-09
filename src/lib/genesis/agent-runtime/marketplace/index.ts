/** App Demand Marketplace (V8 G8) — match apps ↔ demand (the network effect).
 *
 * Every registered app carries its Product DNA (G3) and an auto-computed demand
 * match, so the marketplace can match in BOTH directions:
 *
 *   app → demand   : who needs this app, where, how urgently (from G3).
 *   problem → apps : given a need/problem query, rank the apps that solve it
 *                    (keyword-fingerprint overlap + category + demand fit).
 *
 * Marketplace intelligence: category coverage + demand GAPS — industries with
 * standing need that no listed app serves yet. Gaps are honest opportunity
 * signals (a computation over listed apps), not fabricated demand.
 *
 * Honesty: apps must be REAL (registered from a built product/opportunity or
 * explicitly submitted). An empty marketplace is empty. Adoption/demand carried
 * from G3 stays SIMULATION-labelled; matching is a transparent computation.
 */

import { db } from "@/lib/db";
import { analyzeDemand } from "../demand";
import { classifyCategory } from "../demand";
import { emit } from "../event-bus";

const STOP = new Set(["the", "a", "an", "for", "and", "or", "to", "of", "in", "on", "with", "that", "this", "is", "are", "be", "your", "you", "it", "as", "at", "by", "from", "build", "app", "tool", "platform", "software", "solution", "users", "people", "need", "want", "help"]);
function tokenize(s: string): string[] {
  return [...new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)))];
}
function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a), sb = new Set(b);
  let inter = 0; for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

async function nextAppId(): Promise<string> {
  const rows = await db.marketplaceApp.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { appId: true } });
  let max = 0; for (const r of rows) { const m = r.appId.match(/^APP-(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `APP-${(max + 1).toString().padStart(6, "0")}`;
}

export interface RegisterInput { name?: string; opportunityId?: string; companyKey?: string; subject?: string; problem?: string; targetUsers?: string; features?: string[]; source?: "BUILT" | "USER_SUBMITTED"; ownerOrgId?: string; personaCount?: number }
export interface MarketplaceAppResult { appId: string; name: string; dnaId: string; category: string; topSegment: string | null; demandScore: number; improvementIdeas: string[] }

/** Register an app: fingerprint it (Product DNA) + auto-match to demand, then list it. */
export async function registerApp(input: RegisterInput): Promise<MarketplaceAppResult> {
  const { dna, match } = await analyzeDemand({ opportunityId: input.opportunityId, subject: input.name ?? input.subject, problem: input.problem, targetUsers: input.targetUsers, features: input.features, personaCount: input.personaCount });
  // Improvement ideas: the customer sim's missing-feature signal for this subject.
  const sim = await db.customerSimulation.findFirst({ where: { subject: dna.subject }, orderBy: { createdAt: "desc" } });
  const improvementIdeas = sim ? (safeParse(sim.missingFeatures) as { feature: string }[]).map((f) => f.feature).slice(0, 5) : [];

  const appId = await nextAppId();
  const name = input.name ?? dna.subject;
  await db.marketplaceApp.create({ data: {
    appId, name, dnaId: dna.dnaId, opportunityId: dna.opportunityId ?? null, companyKey: input.companyKey ?? null, ownerOrgId: input.ownerOrgId ?? null,
    category: dna.category, keywords: JSON.stringify(dna.keywords), problem: dna.problem, targetUsers: dna.targetUsers,
    topSegment: match.topSegment, demandScore: match.demandScore, improvementIdeas: JSON.stringify(improvementIdeas),
    source: input.source ?? "BUILT", status: "LISTED",
  } });
  await emit({ agent: "MARKETPLACE", action: "APP_LISTED", detail: `${appId} "${name}" [${dna.category}] demand ${match.demandScore}, top ${match.topSegment}`, level: "SUCCESS", category: "GROWTH" });
  return { appId, name, dnaId: dna.dnaId, category: dna.category, topSegment: match.topSegment, demandScore: match.demandScore, improvementIdeas };
}

export interface AppMatch { appId: string; name: string; category: string; score: number; demandScore: number; reason: string }

/** problem → apps: rank listed apps that solve a stated need/problem. */
export async function matchProblemToApps(query: string, limit = 10): Promise<AppMatch[]> {
  const qTokens = tokenize(query);
  const qCategory = classifyCategory(query);
  const apps = await db.marketplaceApp.findMany({ where: { status: "LISTED" } });
  const scored = apps.map((app) => {
    const overlap = jaccard(qTokens, safeParse(app.keywords) as string[]);
    const catMatch = app.category === qCategory && qCategory !== "Other" ? 1 : 0;
    // Relevance gate: without keyword overlap OR a category hit, an app does NOT
    // match — demand score is only a tiebreaker among genuinely relevant apps.
    const relevant = overlap > 0 || catMatch > 0;
    const score = relevant ? Math.round((overlap * 0.6 + catMatch * 0.3 + (app.demandScore / 100) * 0.1) * 100) : 0;
    const reasonBits = [`${Math.round(overlap * 100)}% keyword overlap`];
    if (catMatch) reasonBits.push(`category ${app.category}`);
    return { appId: app.appId, name: app.name, category: app.category, score, demandScore: app.demandScore, reason: reasonBits.join(", ") };
  }).filter((a) => a.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  return scored;
}

const INDUSTRIES = ["SaaS", "Finance", "Healthcare", "Retail", "Education", "Legal", "Manufacturing", "Marketing", "Real Estate", "Logistics"];

export interface MarketplaceStats {
  total: number; byCategory: Record<string, number>;
  coveredSegments: string[]; demandGaps: string[]; // industries served / unserved by any listed app
  avgDemandScore: number;
}

/** Marketplace intelligence: coverage + demand gaps (unserved segments = opportunity signals). */
export async function marketplaceStats(): Promise<MarketplaceStats> {
  const apps = await db.marketplaceApp.findMany({ where: { status: "LISTED" } });
  const byCategory: Record<string, number> = {};
  const covered = new Set<string>();
  let demandSum = 0;
  for (const a of apps) {
    byCategory[a.category] = (byCategory[a.category] ?? 0) + 1;
    if (a.topSegment) covered.add(a.topSegment);
    demandSum += a.demandScore;
  }
  const demandGaps = INDUSTRIES.filter((i) => !covered.has(i));
  return { total: apps.length, byCategory, coveredSegments: [...covered], demandGaps, avgDemandScore: apps.length ? Math.round(demandSum / apps.length) : 0 };
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return []; } }
