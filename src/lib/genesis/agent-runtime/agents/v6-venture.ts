/** V6 Phase 3 — AI Venture Analyst.
 *
 * Judges an opportunity the way a top-tier VC would: not "is this a viable
 * business" (that is BUSINESS_VALIDATION's demand/feasibility lens) but "is
 * this a power-law outcome, and is now the moment?". Scores seven venture
 * dimensions — market size, timing, moat, competition, distribution, founder
 * advantage, growth potential — into a single VENTURE_SCORE and an
 * INVEST / WATCH / PASS verdict with a written thesis.
 *
 * Its output flows through the orchestrator's dependency handoff into the AI
 * Boardroom context, so the board debates a quantified venture rather than raw
 * signals.
 *
 * Honesty (directive FORBIDDEN: never fake): without an LLM every score is a
 * deterministic function of the numeric signals and is labelled
 * `mode: "HEURISTIC"`; `unknowns` explicitly lists what is assumed rather than
 * known (e.g. founder advantage) so a thin analysis can never masquerade as
 * conviction.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { db } from "@/lib/db";
import { BaseAgent, type AgentRunContext, type AgentRunInput } from "../base-agent";
import { parseJsonResponse } from "../types";
import { assertClaim } from "../aegis";

interface VentureDimensions {
  marketSize: number; timing: number; moat: number; competition: number;
  distribution: number; founderAdvantage: number; growthPotential: number;
}

// VC weighting: market and growth dominate; founder advantage is a light thumb.
const WEIGHTS: Record<keyof VentureDimensions, number> = {
  marketSize: 0.22, growthPotential: 0.18, moat: 0.16, timing: 0.14,
  distribution: 0.12, competition: 0.10, founderAdvantage: 0.08,
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export class VentureAgent extends BaseAgent {
  readonly name = "VENTURE";
  readonly department = "growth";
  readonly description = "Judge opportunities like a VC. Output: VENTURE_SCORE + INVEST/WATCH/PASS.";

  protected async run(input: AgentRunInput, ctx: AgentRunContext) {
    // Resolve subject: a discovered Opportunity, or the raw goal + handoff context.
    const opportunityId = (input.context?.opportunityId as string) ?? undefined;
    const opp = opportunityId ? await db.opportunity.findUnique({ where: { opportunityId } }) : null;

    const c = input.context ?? {};
    const signals = {
      potentialValue: num(opp?.potentialValue ?? c.potentialValue ?? c.value, 5), // 1-10
      difficulty: num(opp?.difficulty ?? c.difficulty, 5), // 1-10
      confidence: num(opp?.confidence ?? c.confidence, 50), // 0-100
      competition: num(c.competition, 5), // 1-10 (higher = more crowded)
      evidenceCount: num(c.evidenceCount ?? (opp?.evidence ? safeLen(opp.evidence) : 0), 0),
    };
    const subject = opp?.title ?? (typeof c.subject === "string" ? c.subject : input.goal);
    const problem = opp?.problem ?? (typeof c.problem === "string" ? c.problem : "");
    const market = opp?.market ?? (typeof c.market === "string" ? c.market : "");

    let dims: VentureDimensions;
    let thesis: string;
    let risks: string[];
    let unknowns: string[];
    let mode: "LLM" | "HEURISTIC" = "HEURISTIC";

    try {
      const r = await ctx.llm(
        `You are a top-tier venture analyst. Judge the venture on seven dimensions, each 0-100: ` +
          `marketSize, timing (is now the moment), moat (defensibility), competition (100 = wide open, 0 = brutally crowded), ` +
          `distribution (repeatable affordable reach), founderAdvantage (unfair advantage), growthPotential (power-law upside). ` +
          `Also give a one-paragraph thesis, risks, and unknowns (what you cannot yet verify). ` +
          `Respond ONLY with JSON: {"marketSize":N,"timing":N,"moat":N,"competition":N,"distribution":N,"founderAdvantage":N,"growthPotential":N,"thesis":"…","risks":["…"],"unknowns":["…"]}.`,
        `Venture: ${subject}\nProblem: ${problem}\nMarket: ${market}\nSignals: potentialValue ${signals.potentialValue}/10, difficulty ${signals.difficulty}/10, evidence ${signals.evidenceCount} sources, crowdedness ${signals.competition}/10.`,
        { temperature: 0.3, maxTokens: 900, timeoutMs: 10_000 },
      );
      if (!r.ok) throw new Error(r.error);
      const p = parseJsonResponse(r.text) as (Partial<VentureDimensions> & { thesis?: string; risks?: string[]; unknowns?: string[] }) | null;
      if (!p || p.marketSize === undefined) throw new Error("no scores");
      dims = {
        marketSize: clamp(num(p.marketSize, 50)), timing: clamp(num(p.timing, 50)), moat: clamp(num(p.moat, 50)),
        competition: clamp(num(p.competition, 50)), distribution: clamp(num(p.distribution, 50)),
        founderAdvantage: clamp(num(p.founderAdvantage, 50)), growthPotential: clamp(num(p.growthPotential, 50)),
      };
      thesis = p.thesis ?? "";
      risks = Array.isArray(p.risks) ? p.risks.filter((x) => typeof x === "string").slice(0, 6) : [];
      unknowns = Array.isArray(p.unknowns) ? p.unknowns.filter((x) => typeof x === "string").slice(0, 6) : [];
      mode = "LLM";
    } catch {
      ({ dims, thesis, risks, unknowns } = heuristicAnalysis(signals, subject));
      await ctx.emit({ action: "FALLBACK", detail: "no LLM — heuristic venture scoring", level: "WARNING", category: "OPPORTUNITY" });
    }

    const ventureScore = clamp(
      (Object.keys(WEIGHTS) as (keyof VentureDimensions)[]).reduce((s, k) => s + dims[k] * WEIGHTS[k], 0),
    );
    let verdict = ventureScore >= 70 ? "INVEST" : ventureScore >= 45 ? "WATCH" : "PASS";

    // count()+1 collides after any deletion — allocate from the numeric max instead.
    const analysisId = `VC-${(await nextAnalysisNumber()).toString().padStart(6, "0")}`;

    // AEGIS Truth check: the headline market claim must be backed by REAL evidence.
    // Only the opportunity's gathered sources count as support (WEB); the numeric
    // signals are recorded as NEUTRAL/COMPUTED so a score can never masquerade as
    // verified demand. No evidence ⇒ UNSUPPORTED ⇒ INVEST is capped to WATCH.
    const oppEvidence = opp?.evidence ? (JSON.parse(opp.evidence) as { url?: string; snippet?: string }[]) : [];
    const truth = await assertClaim({
      statement: `Market demand supports a venture-scale outcome for "${subject}"`,
      subject: opp?.opportunityId ?? analysisId,
      category: "MARKET",
      source: `VENTURE:${ctx.executionId}`,
      evidence: [
        ...oppEvidence.slice(0, 6).map((e) => ({ stance: "SUPPORT" as const, summary: (e.snippet ?? e.url ?? "source").slice(0, 200), source: e.url ?? "opportunity-scan", sourceType: "WEB" as const, weight: 0.6 })),
        { stance: "NEUTRAL" as const, summary: `Computed signals: value ${signals.potentialValue}/10, growth ${dims.growthPotential}/100, crowdedness ${signals.competition}/10`, source: `VENTURE:${analysisId}`, sourceType: "COMPUTED" as const, weight: 0.2 },
      ],
      unknowns,
    }).catch(() => null);

    if (verdict === "INVEST" && truth && truth.verdict !== "SUPPORTED") {
      verdict = "WATCH"; // never allow unsupported confidence to reach INVEST
      await ctx.emit({ action: "TRUTH_CAP", detail: `INVEST→WATCH: market claim ${truth.verdict} (truth ${truth.truthScore}%)`, level: "WARNING", category: "RESEARCH" });
    }

    const truthLine = truth ? `TRUTH: market claim ${truth.verdict} (${truth.truthScore}%, ${truth.supportCount} sources / ${truth.contradictCount} contradictions)` : "TRUTH: not checked";
    const artifactPath = path.join(ctx.sandboxRoot, "VENTURE_SCORE.md");
    await fs.writeFile(artifactPath, renderMarkdown({ analysisId, subject, dims, ventureScore, verdict, thesis, risks, unknowns, mode }) + `\n\n## Evidence check (AEGIS)\n${truthLine}\n`, "utf8");
    const stat = await fs.stat(artifactPath);

    await db.ventureAnalysis.create({
      data: {
        analysisId, opportunityId: opp?.opportunityId ?? null, subject,
        marketSize: dims.marketSize, timing: dims.timing, moat: dims.moat, competition: dims.competition,
        distribution: dims.distribution, founderAdvantage: dims.founderAdvantage, growthPotential: dims.growthPotential,
        ventureScore, verdict, thesis, risks: JSON.stringify(risks), unknowns: JSON.stringify(unknowns), mode, artifactPath,
      },
    });

    await ctx.emit({ action: "VENTURE_SCORE", detail: `${subject}: ${ventureScore}/100 → ${verdict} (${mode})`, level: verdict === "PASS" ? "WARNING" : "SUCCESS", category: "OPPORTUNITY" });
    await ctx.recordMemory({
      type: "SEMANTIC",
      title: `Venture analysis: ${subject} → ${verdict} (${ventureScore})`,
      content: `VENTURE_SCORE ${ventureScore}/100. market=${dims.marketSize} timing=${dims.timing} moat=${dims.moat} competition=${dims.competition} distribution=${dims.distribution} founder=${dims.founderAdvantage} growth=${dims.growthPotential}. Thesis: ${thesis}`,
      tags: ["venture", "vc", verdict.toLowerCase()],
      importance: 8,
    });

    return {
      summary: `Venture score for "${subject}": ${ventureScore}/100 → ${verdict}.${truth ? ` Evidence: ${truth.verdict} (${truth.truthScore}%).` : ""}`,
      artifacts: [{ type: "REPORT", path: artifactPath, description: "VENTURE_SCORE", size: stat.size }],
      // These fields flow into the boardroom context via dependency handoff — the
      // board debates a venture score AND its evidence-grounding (truthScore).
      output: { analysisId, opportunityId: opp?.opportunityId, subject, ventureScore, verdict, mode, ...dims, truthScore: truth?.truthScore ?? 0, truthVerdict: truth?.verdict ?? "UNSUPPORTED" },
    };
  }
}

function heuristicAnalysis(s: { potentialValue: number; difficulty: number; confidence: number; competition: number; evidenceCount: number }, subject: string) {
  const dims: VentureDimensions = {
    marketSize: clamp(s.potentialValue * 10),
    growthPotential: clamp(s.potentialValue * 9 + (s.confidence - 50) / 5),
    moat: clamp(40 + (s.potentialValue - 5) * 6 - (s.competition - 5) * 4),
    timing: clamp(50 + (s.confidence - 50) / 2),
    distribution: clamp(60 - (s.competition - 5) * 6),
    competition: clamp(100 - s.competition * 10),
    founderAdvantage: 50, // unknown without a human — declared in `unknowns` below
  };
  const risks: string[] = [];
  if (s.competition >= 7) risks.push("crowded market — competition erodes moat and distribution");
  if (s.difficulty >= 8) risks.push("high build difficulty threatens time-to-market");
  if (s.potentialValue < 5) risks.push("upside may not clear the power-law bar");
  const unknowns: string[] = [
    "founder advantage assumed at baseline (50) — no human founder signal available",
    ...(s.evidenceCount < 2 ? ["market size is inferred from potentialValue, not from measured demand"] : []),
  ];
  const thesis = `[HEURISTIC] "${subject}" scores as a ${dims.growthPotential >= 60 ? "notable" : "modest"} venture from numeric signals alone (value ${s.potentialValue}/10, crowdedness ${s.competition}/10, ${s.evidenceCount} evidence sources). Not a reasoned VC judgement — set ANTHROPIC_API_KEY for real analysis.`;
  return { dims, thesis, risks, unknowns };
}

function renderMarkdown(d: { analysisId: string; subject: string; dims: VentureDimensions; ventureScore: number; verdict: string; thesis: string; risks: string[]; unknowns: string[]; mode: string }): string {
  const banner = d.mode === "HEURISTIC"
    ? "> ⚠️ **HEURISTIC MODE — no LLM configured.** Scores are a deterministic function of numeric signals, not reasoned venture analysis.\n"
    : "> ✅ **LLM MODE — scored by the configured provider.**\n";
  const bar = (n: number) => "█".repeat(Math.round(n / 10)) + "░".repeat(10 - Math.round(n / 10));
  const rows = (Object.keys(WEIGHTS) as (keyof VentureDimensions)[]).map((k) => `| ${k} | ${d.dims[k]} | ${bar(d.dims[k])} | ${Math.round(WEIGHTS[k] * 100)}% |`).join("\n");
  return [
    `# VENTURE_SCORE — ${d.analysisId}`, "", banner,
    `**Subject:** ${d.subject}  `,
    `**VENTURE_SCORE:** ${d.ventureScore}/100 → **${d.verdict}**`, "",
    `## Thesis`, d.thesis, "",
    `## Dimensions`, `| Dimension | Score | | Weight |`, `|---|---|---|---|`, rows, "",
    ...(d.risks.length ? [`## Risks`, ...d.risks.map((r) => `- ⚠️ ${r}`), ""] : []),
    ...(d.unknowns.length ? [`## Unknowns (not yet verified)`, ...d.unknowns.map((u) => `- ❓ ${u}`), ""] : []),
  ].join("\n");
}

function num(v: unknown, d: number): number { return typeof v === "number" && Number.isFinite(v) ? v : d; }
function safeLen(json: string): number { try { const a = JSON.parse(json); return Array.isArray(a) ? a.length : 0; } catch { return 0; } }

/** Numeric max-scan (count()+1 collides after any row deletion — same fix as EX-/CLM- ids). */
async function nextAnalysisNumber(): Promise<number> {
  const rows = await db.ventureAnalysis.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { analysisId: true } });
  let max = 0;
  for (const r of rows) { const m = r.analysisId.match(/^VC-(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return max + 1;
}
