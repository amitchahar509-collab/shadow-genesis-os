/** Demand Graph + Product DNA (V8 G3) — match products to the people who need them.
 *
 * Two composable steps:
 *
 *   computeProductDNA — fingerprint a product/opportunity: problem, category,
 *     features, target users, alternatives, keywords. Deterministic extraction
 *     from real opportunity data (no fabrication).
 *
 *   matchDemand (the Customer Match) — for a DNA, rank demand segments by
 *     market fit and answer: who needs this? where are they? why now? how
 *     urgently? how likely to adopt? → DEMAND_MATCH_SCORE. Adoption comes from
 *     the REAL seeded CUSTOMER simulation (per-industry buy rates); the
 *     category↔industry fit is a transparent heuristic (labelled). The result
 *     is projected into the existing KnowledgeNode/KnowledgeEdge graph
 *     (problem ↔ product ↔ industries).
 *
 * Honesty: adoption numbers are SIMULATION (seeded, reproducible), fit is a
 * labelled heuristic, communities are a reference lookup (a suggestion of where
 * to reach people, not fabricated user data).
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { db } from "@/lib/db";
import { getAgent } from "../agents";
import { emit } from "../event-bus";

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Fintech: ["paymen", "invoic", "bookkeep", "account", "bank", "financ", "tax", "billing", "payroll"],
  Healthtech: ["health", "patient", "clinic", "medical", "therapy", "wellness", "fitness"],
  Devtools: ["developer", "api", "code", "deploy", "ci", "devops", "sdk", "debug", "git"],
  Marketing: ["marketing", "seo", "campaign", "content", "social", "ads", "audience", "leads"],
  Ecommerce: ["shop", "store", "ecommerce", "retail", "checkout", "inventory", "orders"],
  Productivity: ["notes", "task", "standup", "meeting", "calendar", "workflow", "productivity", "docs"],
  AI: ["ai", "llm", "model", "agent", "ml", "gpt", "generative", "assistant"],
  Legal: ["legal", "contract", "compliance", "lawyer", "gdpr", "policy"],
};

// Which industries feel each category's problem most acutely (transparent affinity).
const CATEGORY_INDUSTRY_AFFINITY: Record<string, string[]> = {
  Fintech: ["Finance", "Real Estate", "Retail"], Healthtech: ["Healthcare", "Education"],
  Devtools: ["SaaS", "Manufacturing", "Logistics"], Marketing: ["Marketing", "Retail", "Real Estate"],
  Ecommerce: ["Retail", "Logistics", "Manufacturing"], Productivity: ["SaaS", "Legal", "Education"],
  AI: ["SaaS", "Finance", "Marketing"], Legal: ["Legal", "Finance", "Healthcare"], Other: ["SaaS", "Retail"],
};

const INDUSTRY_COMMUNITY: Record<string, string> = {
  SaaS: "IndieHackers / r/SaaS", Finance: "r/fintech / Fintech Slack", Healthcare: "r/healthIT",
  Retail: "r/ecommerce / Shopify forums", Education: "r/edtech", Legal: "r/legaltech",
  Manufacturing: "r/manufacturing", Marketing: "r/marketing / GrowthHackers", "Real Estate": "r/proptech", Logistics: "r/logistics",
};

const STOP = new Set(["the", "a", "an", "for", "and", "or", "to", "of", "in", "on", "with", "that", "this", "is", "are", "be", "your", "you", "it", "as", "at", "by", "from", "build", "app", "tool", "platform", "software", "solution", "users", "people"]);

function tokenize(s: string): string[] {
  return [...new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)))].slice(0, 20);
}

export function classifyCategory(text: string): string {
  const t = text.toLowerCase();
  let best = "Other", bestHits = 0;
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    const hits = kws.filter((k) => t.includes(k)).length;
    if (hits > bestHits) { best = cat; bestHits = hits; }
  }
  return best;
}

async function nextId(prefix: "DNA" | "DM"): Promise<string> {
  const rows = prefix === "DNA"
    ? await db.productDNA.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { dnaId: true } })
    : await db.demandMatch.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { matchId: true } });
  let max = 0; const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const r of rows) { const id = "dnaId" in r ? r.dnaId : r.matchId; const m = id.match(re); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `${prefix}-${(max + 1).toString().padStart(6, "0")}`;
}

export interface ProductDNAResult { dnaId: string; subject: string; problem: string; category: string; features: string[]; targetUsers: string; alternatives: string[]; keywords: string[]; opportunityId?: string }

/** Fingerprint a product/opportunity. */
export async function computeProductDNA(input: { opportunityId?: string; companyKey?: string; subject?: string; problem?: string; targetUsers?: string; features?: string[] }): Promise<ProductDNAResult> {
  const opp = input.opportunityId ? await db.opportunity.findUnique({ where: { opportunityId: input.opportunityId } }) : null;
  const subject = opp?.title ?? input.subject ?? "untitled product";
  const problem = opp?.problem ?? input.problem ?? "";
  const targetUsers = opp?.targetUsers ?? input.targetUsers ?? "";
  const alternatives = opp?.competition
    ? (JSON.parse(opp.competition) as { title?: string }[]).map((c) => c.title ?? "").filter(Boolean).slice(0, 6)
    : [];
  const category = classifyCategory(`${subject} ${problem}`);
  const keywords = tokenize(`${subject} ${problem} ${targetUsers}`);
  // Features: use provided, else infer 2-3 hints from the problem (labelled inferred).
  const features = input.features?.length ? input.features.slice(0, 8) : keywords.slice(0, 3).map((k) => `(inferred) ${k} capability`);

  const dnaId = await nextId("DNA");
  await db.productDNA.create({ data: { dnaId, opportunityId: opp?.opportunityId ?? null, companyKey: input.companyKey ?? null, subject, problem, category, features: JSON.stringify(features), targetUsers, alternatives: JSON.stringify(alternatives), keywords: JSON.stringify(keywords) } });
  await emit({ agent: "DEMAND", action: "PRODUCT_DNA", detail: `${dnaId}: "${subject}" → ${category} [${keywords.slice(0, 5).join(", ")}]`, level: "INFO", category: "GROWTH" });
  return { dnaId, subject, problem, category, features, targetUsers, alternatives, keywords, opportunityId: opp?.opportunityId };
}

export interface DemandSegment { industry: string; community: string; needScore: number; adoptionProbability: number; marketFit: number; urgency: "LOW" | "MEDIUM" | "HIGH"; whyNow: string }
export interface DemandMatchResult { matchId: string; dnaId: string; subject: string; category: string; demandScore: number; topSegment: string; segments: DemandSegment[]; mode: string; artifactPath: string }

/** The Customer Match: rank who needs this product, where, why now, and how likely to adopt. */
export async function matchDemand(dna: ProductDNAResult, opts?: { personaCount?: number }): Promise<DemandMatchResult> {
  // Adoption signal: real seeded CUSTOMER simulation → per-industry buy rates.
  const sim = await getAgent("CUSTOMER")!.execute({
    goal: `demand match: ${dna.subject}`,
    context: { ...(dna.opportunityId ? { opportunityId: dna.opportunityId } : { subject: dna.subject }), personaCount: opts?.personaCount ?? 240 },
  });
  const simId = (sim.output as { simulationId: string }).simulationId;
  const simRow = await db.customerSimulation.findUnique({ where: { simulationId: simId } });
  const buyBySegment = new Map<string, { buyRate: number; n: number }>();
  for (const s of (safeParse(simRow?.segments ?? "[]") as { industry: string; n: number; buyRate: number }[])) buyBySegment.set(s.industry, { buyRate: s.buyRate, n: s.n });

  const affinity = new Set(CATEGORY_INDUSTRY_AFFINITY[dna.category] ?? CATEGORY_INDUSTRY_AFFINITY.Other);
  const segments: DemandSegment[] = [];
  for (const [industry, community] of Object.entries(INDUSTRY_COMMUNITY)) {
    const seg = buyBySegment.get(industry);
    if (!seg || seg.n < 5) continue; // only segments the simulation actually populated
    const adoptionProbability = clamp(seg.buyRate);
    // Need = category/industry affinity + adoption signal (transparent heuristic).
    const needScore = clamp((affinity.has(industry) ? 65 : 40) + adoptionProbability * 0.3);
    const marketFit = clamp(adoptionProbability * 0.55 + needScore * 0.45);
    const urgency: DemandSegment["urgency"] = needScore >= 70 ? "HIGH" : needScore >= 50 ? "MEDIUM" : "LOW";
    const whyNow = affinity.has(industry)
      ? `${industry} feels ${dna.category} pain acutely; ${adoptionProbability}% of simulated buyers convert.`
      : `Secondary fit; ${adoptionProbability}% simulated conversion.`;
    segments.push({ industry, community, needScore, adoptionProbability, marketFit, urgency, whyNow });
  }
  segments.sort((a, b) => b.marketFit - a.marketFit);

  const top = segments.slice(0, 3);
  const demandScore = top.length ? clamp(top.reduce((s, x) => s + x.marketFit, 0) / top.length) : 0;
  const topSegment = segments[0]?.industry ?? "none";
  const mode = "HEURISTIC";
  const matchId = await nextId("DM");

  const artifactDir = path.resolve(process.cwd(), ".genesis-workspace", "demand", matchId);
  await fs.mkdir(artifactDir, { recursive: true }).catch(() => {});
  const artifactPath = path.join(artifactDir, "DEMAND_MAP.md");
  await fs.writeFile(artifactPath, renderMarkdown(matchId, dna, demandScore, segments), "utf8").catch(() => {});

  await db.demandMatch.create({ data: { matchId, dnaId: dna.dnaId, subject: dna.subject, demandScore, topSegment, segments: JSON.stringify(segments), mode, artifactPath } });
  await projectToGraph(dna, top);

  await emit({ agent: "DEMAND", action: "DEMAND_MATCH", detail: `${matchId}: "${dna.subject}" → ${demandScore}/100, top ${topSegment} (${top[0]?.adoptionProbability ?? 0}% adopt)`, level: demandScore >= 50 ? "SUCCESS" : "INFO", category: "GROWTH" });
  return { matchId, dnaId: dna.dnaId, subject: dna.subject, category: dna.category, demandScore, topSegment, segments, mode, artifactPath };
}

/** One-shot: fingerprint then match. */
export async function analyzeDemand(input: { opportunityId?: string; subject?: string; problem?: string; targetUsers?: string; features?: string[]; personaCount?: number }): Promise<{ dna: ProductDNAResult; match: DemandMatchResult }> {
  const dna = await computeProductDNA(input);
  const match = await matchDemand(dna, { personaCount: input.personaCount });
  return { dna, match };
}

/** Project the match into the existing knowledge graph: product ↔ problem ↔ industries. */
async function projectToGraph(dna: ProductDNAResult, top: DemandSegment[]): Promise<void> {
  try {
    const product = await db.knowledgeNode.create({ data: { type: "ENTITY", label: dna.subject, description: `${dna.category} product (DNA ${dna.dnaId})`, properties: JSON.stringify({ dnaId: dna.dnaId, category: dna.category }) } });
    if (dna.problem) {
      const problem = await db.knowledgeNode.create({ data: { type: "CONCEPT", label: dna.problem.slice(0, 80), description: "problem solved", properties: "{}" } });
      await db.knowledgeEdge.create({ data: { fromNodeId: product.id, toNodeId: problem.id, relation: "DEPENDS_ON", weight: 1 } });
    }
    for (const seg of top) {
      const ind = await db.knowledgeNode.create({ data: { type: "ENTITY", label: seg.industry, description: `demand segment (${seg.community})`, properties: JSON.stringify({ marketFit: seg.marketFit, adoption: seg.adoptionProbability }) } });
      await db.knowledgeEdge.create({ data: { fromNodeId: product.id, toNodeId: ind.id, relation: "RELATES_TO", weight: seg.marketFit / 100, evidence: JSON.stringify([`marketFit ${seg.marketFit}`, `adoption ${seg.adoptionProbability}%`]) } });
    }
  } catch { /* graph projection is best-effort */ }
}

function renderMarkdown(matchId: string, dna: ProductDNAResult, demandScore: number, segments: DemandSegment[]): string {
  return [
    `# DEMAND_MAP — ${matchId}`, "",
    `> ⚠️ Adoption = seeded CUSTOMER **SIMULATION** (reproducible); category↔industry fit is a labelled heuristic; communities are suggestions, not user data.`, "",
    `**Product:** ${dna.subject} (${dna.category}) · DNA ${dna.dnaId}`,
    `**Problem:** ${dna.problem}`,
    `**DEMAND_MATCH_SCORE:** ${demandScore}/100`, "",
    `## Who needs this — where — why now`,
    `| Rank | Industry | Community (where) | Need | Adoption | Fit | Urgency | Why now |`,
    `|---|---|---|---|---|---|---|---|`,
    ...segments.map((s, i) => `| ${i + 1} | ${s.industry} | ${s.community} | ${s.needScore} | ${s.adoptionProbability}% | **${s.marketFit}** | ${s.urgency} | ${s.whyNow} |`),
    "", `## Product DNA`, `- **Category:** ${dna.category}`, `- **Keywords:** ${dna.keywords.join(", ")}`, `- **Target users:** ${dna.targetUsers || "—"}`, `- **Alternatives:** ${dna.alternatives.join(", ") || "—"}`,
  ].join("\n");
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return []; } }
