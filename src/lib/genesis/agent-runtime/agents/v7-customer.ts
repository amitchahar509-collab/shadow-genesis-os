/** V7 Phase 2 — Digital Customer Simulation Engine.
 *
 * Generates N virtual customers for an opportunity and simulates whether each
 * would BUY / MAYBE / NO_BUY, with willingness-to-pay, objections, buying
 * triggers, and missing features. Aggregates into a CUSTOMER_REALITY_SCORE.
 *
 * Honesty (directive FORBIDDEN: never fake users): these are PROCEDURALLY
 * GENERATED personas, not real people. Every artifact, memory, and the AEGIS
 * claim it asserts are labelled SIMULATION with low evidence weight — a
 * simulated buy-rate can never be laundered into real market evidence. The RNG
 * is seeded from the subject so a given opportunity simulates reproducibly.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { db } from "@/lib/db";
import { BaseAgent, type AgentRunContext, type AgentRunInput } from "../base-agent";
import { assertClaim } from "../aegis";

const INDUSTRIES = ["SaaS", "Healthcare", "Finance", "Retail", "Education", "Legal", "Manufacturing", "Marketing", "Real Estate", "Logistics"];
const ROLES = ["Founder", "Ops Manager", "Analyst", "Director", "Individual Contributor", "Consultant"];
const OBJECTIONS = { price: "too expensive for the value", current: "satisfied with our current solution", urgency: "not a priority right now", trust: "unproven vendor / switching risk", feature: "missing a capability we need" };
const TRIGGERS = ["a painful failure of the current tool", "budget freed up this quarter", "a peer recommendation", "a clear ROI case", "a compliance deadline"];
const FEATURES = ["integrations with our stack", "team/roles support", "audit & compliance", "better reporting", "an API", "white-glove onboarding"];

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** Deterministic RNG (mulberry32) so a subject simulates reproducibly. */
function makeRng(seedStr: string) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

interface Persona {
  industry: string; role: string; problemIntensity: number; budget: number; currentSolution: string;
  decision: "BUY" | "MAYBE" | "NO_BUY"; willingnessToPay: number; objection?: string; trigger?: string; reasoning: string;
}

export class CustomerSimulationAgent extends BaseAgent {
  readonly name = "CUSTOMER";
  readonly department = "growth";
  readonly description = "Simulate virtual customers → CUSTOMER_REALITY_SCORE. SIMULATION, not real users.";

  protected async run(input: AgentRunInput, ctx: AgentRunContext) {
    const c = input.context ?? {};
    const opportunityId = (c.opportunityId as string) ?? undefined;
    const opp = opportunityId ? await db.opportunity.findUnique({ where: { opportunityId } }) : null;
    const subject = opp?.title ?? (typeof c.subject === "string" ? c.subject : input.goal);

    const potentialValue = num(opp?.potentialValue ?? c.potentialValue ?? c.value, 5); // 1-10
    const competition = num(c.competition, 5); // 1-10 crowdedness
    const productPrice = num(c.price, 30 + potentialValue * 10); // monthly $
    const count = Math.max(1, Math.min(2000, num(c.personaCount, 200))); // default 200, expandable

    const rng = makeRng(`${subject}|${potentialValue}|${competition}|${count}`);
    const gauss = (mean: number, sd: number) => mean + sd * Math.sqrt(-2 * Math.log(rng() || 1e-9)) * Math.cos(2 * Math.PI * rng());

    const personas: Persona[] = [];
    for (let i = 0; i < count; i++) {
      const industry = INDUSTRIES[Math.floor(rng() * INDUSTRIES.length)];
      const role = ROLES[Math.floor(rng() * ROLES.length)];
      const problemIntensity = clamp(gauss(35 + potentialValue * 5, 22));
      const roleBudget = role === "Founder" || role === "Director" ? 400 : role === "Consultant" ? 250 : 120;
      const budget = Math.max(0, gauss(roleBudget, roleBudget * 0.6));
      const hasIncumbent = rng() < competition / 12; // crowded market ⇒ more already using a competitor
      const currentSolution = hasIncumbent ? "existing competitor" : rng() < 0.5 ? "manual / spreadsheets" : "nothing";

      // Buy propensity: acute pain + affordability, minus switching resistance, plus noise.
      const affordability = budget >= productPrice ? 1 : budget / Math.max(1, productPrice);
      const switchingResistance = hasIncumbent ? 0.35 + rng() * 0.25 : 0;
      const buyScore = 0.5 * (problemIntensity / 100) + 0.3 * affordability - 0.25 * switchingResistance + (rng() - 0.5) * 0.15;

      let decision: Persona["decision"]; let objection: string | undefined; let trigger: string | undefined;
      if (buyScore > 0.55) decision = "BUY";
      else if (buyScore > 0.4) decision = "MAYBE";
      else decision = "NO_BUY";

      if (decision !== "BUY") {
        if (budget < productPrice) objection = OBJECTIONS.price;
        else if (hasIncumbent) objection = OBJECTIONS.current;
        else if (problemIntensity < 35) objection = OBJECTIONS.urgency;
        else objection = rng() < 0.5 ? OBJECTIONS.trust : OBJECTIONS.feature;
      }
      if (decision !== "NO_BUY") trigger = TRIGGERS[Math.floor(rng() * TRIGGERS.length)];

      const willingnessToPay = decision === "NO_BUY" ? Math.round(budget * 0.1) : Math.round(productPrice * (0.6 + (problemIntensity / 100) * 0.8));
      personas.push({ industry, role, problemIntensity: Math.round(problemIntensity), budget: Math.round(budget), currentSolution, decision, willingnessToPay, objection, trigger, reasoning: `${role} in ${industry}, pain ${Math.round(problemIntensity)}/100, budget $${Math.round(budget)} vs $${productPrice} → ${decision}` });
    }

    // Aggregate.
    const buyers = personas.filter((p) => p.decision === "BUY");
    const maybes = personas.filter((p) => p.decision === "MAYBE");
    const buyRate = round1((buyers.length / count) * 100);
    const maybeRate = round1((maybes.length / count) * 100);
    const interested = [...buyers, ...maybes];
    const avgWTP = interested.length ? Math.round(interested.reduce((s, p) => s + p.willingnessToPay, 0) / interested.length) : 0;
    const wtps = buyers.map((p) => p.willingnessToPay).sort((a, b) => a - b);
    const pricePoints = { p25: percentile(wtps, 25), median: percentile(wtps, 50), p75: percentile(wtps, 75) };
    const avgIntensity = personas.reduce((s, p) => s + p.problemIntensity, 0) / count;

    const topObjections = topCounts(personas.map((p) => p.objection));
    const topTriggers = topCounts(personas.map((p) => p.trigger));
    // Missing-feature signal is only meaningful among the "missing a capability" objectors.
    const missingFeatures = personas.some((p) => p.objection === OBJECTIONS.feature)
      ? topCounts(personas.filter((p) => p.objection === OBJECTIONS.feature).map(() => FEATURES[Math.floor(rng() * FEATURES.length)])) : [];
    const segments = INDUSTRIES.map((ind) => { const seg = personas.filter((p) => p.industry === ind); return seg.length ? { industry: ind, n: seg.length, buyRate: round1((seg.filter((p) => p.decision === "BUY").length / seg.length) * 100) } : null; }).filter(Boolean);

    // CUSTOMER_REALITY_SCORE: conversion (buy + half-maybe), demand intensity, and WTP alignment vs price.
    const conversion = buyRate + maybeRate * 0.5;
    const wtpAlignment = clamp((avgWTP / Math.max(1, productPrice)) * 60);
    const realityScore = Math.round(clamp(conversion * 0.5 + avgIntensity * 0.25 + wtpAlignment * 0.25));

    const mode = "HEURISTIC"; // LLM enrichment is a future upgrade; today personas are procedural.
    // Numeric max-scan — count()+1 collides after any row deletion.
    const simulationId = `SIM-${(await nextSimNumber()).toString().padStart(6, "0")}`;

    // AEGIS: assert a SIMULATION-typed demand claim. Low weight, honest provenance —
    // a simulated buy-rate is a hypothesis, not verified market demand.
    const truth = await assertClaim({
      statement: `Simulated target customers would adopt "${subject}"`,
      subject: opp?.opportunityId ?? simulationId, category: "DEMAND", source: `CUSTOMER:${ctx.executionId}`,
      evidence: [{ stance: buyRate >= 40 ? "SUPPORT" : "CONTRADICT", summary: `${count}-persona simulation: ${buyRate}% BUY, ${maybeRate}% MAYBE, reality ${realityScore}/100`, source: `CUSTOMER_SIM:${simulationId}`, sourceType: "SIMULATION", weight: 0.3 }],
      unknowns: ["personas are procedurally generated, not real customers", "willingness-to-pay is modelled, not observed"],
    }).catch(() => null);

    const artifactPath = path.join(ctx.sandboxRoot, "CUSTOMER_REALITY.md");
    await fs.writeFile(artifactPath, renderMarkdown({ simulationId, subject, count, buyRate, maybeRate, realityScore, avgWTP, productPrice, pricePoints, topObjections, topTriggers, missingFeatures, segments, truth }), "utf8");
    const stat = await fs.stat(artifactPath);

    await db.customerSimulation.create({
      data: {
        simulationId, subject, opportunityId: opp?.opportunityId ?? null, personaCount: count,
        buyRate, maybeRate, realityScore, avgWillingnessToPay: avgWTP, pricePoints: JSON.stringify(pricePoints),
        topObjections: JSON.stringify(topObjections), topTriggers: JSON.stringify(topTriggers),
        missingFeatures: JSON.stringify(missingFeatures), segments: JSON.stringify(segments), mode, artifactPath,
        // Persist a representative sample (first 24), not all N.
        personas: { create: sample(personas, 24).map((p, i) => ({ personaId: `CUST-${simulationId.slice(4)}-${i.toString().padStart(2, "0")}`, industry: p.industry, role: p.role, problemIntensity: p.problemIntensity, budget: p.budget, currentSolution: p.currentSolution, decision: p.decision, willingnessToPay: p.willingnessToPay, objection: p.objection ?? null, trigger: p.trigger ?? null, reasoning: p.reasoning })) },
      },
    });

    await ctx.emit({ action: "CUSTOMER_REALITY", detail: `${subject}: ${count} personas → ${buyRate}% buy, reality ${realityScore}/100 (SIMULATION)`, level: realityScore >= 50 ? "SUCCESS" : "WARNING", category: "OPPORTUNITY" });
    await ctx.recordMemory({ type: "SEMANTIC", title: `Customer simulation: ${subject} → reality ${realityScore}/100`, content: `${count} simulated personas: ${buyRate}% buy, ${maybeRate}% maybe, avg WTP $${avgWTP} (price $${productPrice}). Top objection: ${topObjections[0]?.objection ?? "n/a"}.`, tags: ["customer", "simulation", "reality"], importance: 7 });

    return {
      summary: `Simulated ${count} customers for "${subject}": ${buyRate}% buy → CUSTOMER_REALITY_SCORE ${realityScore}/100 (SIMULATION).`,
      artifacts: [{ type: "REPORT", path: artifactPath, description: "CUSTOMER_REALITY", size: stat.size }],
      // Flows into boardroom context via dependency handoff — the Customer seat reads it.
      output: { simulationId, opportunityId: opp?.opportunityId, subject, personaCount: count, buyRate, maybeRate, customerRealityScore: realityScore, avgWillingnessToPay: avgWTP, mode },
    };
  }
}

function renderMarkdown(d: { simulationId: string; subject: string; count: number; buyRate: number; maybeRate: number; realityScore: number; avgWTP: number; productPrice: number; pricePoints: { p25: number; median: number; p75: number }; topObjections: { objection: string; count: number }[]; topTriggers: { trigger: string; count: number }[]; missingFeatures: { feature: string; count: number }[]; segments: unknown[]; truth: { verdict: string; truthScore: number } | null }): string {
  const lines = [
    `# CUSTOMER_REALITY — ${d.simulationId}`, "",
    `> ⚠️ **SIMULATION — procedurally generated personas, not real customers.** A modelled buy-rate is a hypothesis to test, not verified demand.`, "",
    `**Subject:** ${d.subject}  `,
    `**CUSTOMER_REALITY_SCORE:** ${d.realityScore}/100 · **Buy:** ${d.buyRate}% · **Maybe:** ${d.maybeRate}% · **Personas:** ${d.count}`,
    `**Avg willingness-to-pay:** $${d.avgWTP}/mo vs list price $${d.productPrice}/mo · **Buyer price band:** $${d.pricePoints.p25}–$${d.pricePoints.p75} (median $${d.pricePoints.median})`,
    d.truth ? `**AEGIS demand claim:** ${d.truth.verdict} (${d.truth.truthScore}%, SIMULATION-weighted)` : "",
    "", `## Top objections`, ...(d.topObjections.length ? d.topObjections.map((o) => `- ${o.objection} (${o.count})`) : ["- none"]),
    "", `## Buying triggers`, ...(d.topTriggers.length ? d.topTriggers.map((t) => `- ${t.trigger} (${t.count})`) : ["- none"]),
    ...(d.missingFeatures.length ? ["", `## Requested / missing features`, ...d.missingFeatures.map((f) => `- ${f.feature} (${f.count})`)] : []),
    "", `## Segment buy-rates`, "```json", JSON.stringify(d.segments, null, 2), "```",
  ];
  return lines.filter((l) => l !== "").join("\n");
}

function num(v: unknown, d: number): number { return typeof v === "number" && Number.isFinite(v) ? v : d; }
function round1(n: number): number { return Math.round(n * 10) / 10; }
function percentile(sorted: number[], p: number): number { if (!sorted.length) return 0; const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length)); return sorted[idx]; }
function topCounts<T extends string | undefined>(xs: T[]): { objection: string; trigger: string; feature: string; count: number }[] {
  const m = new Map<string, number>();
  for (const x of xs) if (x) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, count]) => ({ objection: k, trigger: k, feature: k, count }));
}
function sample<T>(xs: T[], n: number): T[] { return xs.slice(0, n); }

async function nextSimNumber(): Promise<number> {
  const rows = await db.customerSimulation.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { simulationId: true } });
  let max = 0;
  for (const r of rows) { const m = r.simulationId.match(/^SIM-(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return max + 1;
}
