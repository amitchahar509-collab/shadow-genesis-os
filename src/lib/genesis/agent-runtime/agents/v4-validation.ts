/** V4 Phase 3 — Business Validation Engine.
 *
 * Validates opportunities before building. Computes BUSINESS_SCORE based
 * on demand, competition, timing, feasibility, monetization. Kills weak
 * ideas (recommendation: KILL).
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { db } from "@/lib/db";
import { BaseAgent, type AgentRunContext, type AgentRunInput } from "../base-agent";
import { parseJsonResponse } from "../types";

export class BusinessValidationAgent extends BaseAgent {
  readonly name = "BUSINESS_VALIDATION"; // pseudo-agent; runs via OpportunityAgent path
  readonly department = "growth";
  readonly description = "Validate opportunities. Output: BUSINESS_SCORE + BUILD/REVIEW/KILL.";

  protected async run(input: AgentRunInput, ctx: AgentRunContext) {
    const opportunityId = (input.context?.opportunityId as string) ?? input.goal;
    const opp = await db.opportunity.findUnique({ where: { opportunityId } });
    if (!opp) {
      return { summary: `opportunity ${opportunityId} not found`, artifacts: [], output: { ok: false } };
    }

    // Gather additional evidence
    const searchOut = await ctx.tool("browser", "search", { query: `${opp.title} demand users pay`, count: 5 });
    const demandResults = searchOut.ok ? ((searchOut.result as { results?: { title: string; url: string; snippet?: string }[] })?.results ?? []) : [];

    // Compute scores via LLM
    let scores: { demandScore: number; competitionScore: number; timingScore: number; feasibilityScore: number; monetizationScore: number; risks: string[]; channels: string[]; };
    try {
      const r = await ctx.llm(
        `You are a business validation engine. Score 0-100 on each: demand, competition (higher=less competition), timing, feasibility, monetization. Also list risks and distribution channels. Respond ONLY with JSON: {"demandScore":N,"competitionScore":N,"timingScore":N,"feasibilityScore":N,"monetizationScore":N,"risks":[...],"channels":[...]}.`,
        `Opportunity: ${opp.title}\nProblem: ${opp.problem}\nMarket: ${opp.market}\nTarget users: ${opp.targetUsers}\nDifficulty: ${opp.difficulty}/10\nPotential value: ${opp.potentialValue}/10\n\nDemand signals:\n${demandResults.slice(0, 5).map((r) => `- ${r.title}: ${r.snippet ?? ""}`).join("\n")}`,
        { temperature: 0.3, maxTokens: 1000, timeoutMs: 10_000 },
      );
      if (!r.ok) throw new Error(r.error);
      const parsed = parseJsonResponse(r.text) as typeof scores | null;
      if (!parsed) throw new Error("no scores");
      scores = parsed;
    } catch {
      // Rule-based fallback
      scores = {
        demandScore: Math.min(opp.potentialValue * 10, 80),
        competitionScore: Math.max(50 - opp.difficulty * 3, 20),
        timingScore: 60,
        feasibilityScore: Math.max(80 - opp.difficulty * 5, 30),
        monetizationScore: 50,
        risks: [`High difficulty (${opp.difficulty}/10)`, "Unknown market size"],
        channels: ["Direct sales", "Content marketing", "Partnerships"],
      };
    }

    // Weighted overall
    const overallScore = Math.round(
      scores.demandScore * 0.25 +
      scores.competitionScore * 0.20 +
      scores.timingScore * 0.20 +
      scores.feasibilityScore * 0.15 +
      scores.monetizationScore * 0.20,
    );
    const recommendation = overallScore >= 70 ? "BUILD" : overallScore >= 45 ? "REVIEW" : "KILL";

    // Persist
    const validation = await db.businessValidation.create({
      data: {
        opportunityId: opp.opportunityId,
        demandScore: scores.demandScore,
        competitionScore: scores.competitionScore,
        timingScore: scores.timingScore,
        feasibilityScore: scores.feasibilityScore,
        monetizationScore: scores.monetizationScore,
        overallScore,
        recommendation,
        evidence: JSON.stringify(demandResults.slice(0, 5)),
        risks: JSON.stringify(scores.risks),
        channels: JSON.stringify(scores.channels),
      },
    });

    // Update opportunity
    await db.opportunity.update({
      where: { opportunityId: opp.opportunityId },
      data: { businessScore: overallScore, status: recommendation === "KILL" ? "KILLED" : "VALIDATED" },
    });

    await ctx.emit({
      action: "VALIDATION",
      detail: `${opp.title}: ${overallScore}/100 → ${recommendation}`,
      level: recommendation === "KILL" ? "WARNING" : "SUCCESS",
      category: "OPPORTUNITY",
    });

    // Record SEMANTIC memory
    await ctx.recordMemory({
      type: "SEMANTIC",
      title: `Business validation: ${opp.title} → ${recommendation} (${overallScore})`,
      content: `Scores: demand=${scores.demandScore}, competition=${scores.competitionScore}, timing=${scores.timingScore}, feasibility=${scores.feasibilityScore}, monetization=${scores.monetizationScore}. Risks: ${scores.risks.join("; ")}. Channels: ${scores.channels.join(", ")}.`,
      tags: ["validation", "business", recommendation.toLowerCase()],
      importance: 8,
    });

    // Artifact
    const reportPath = path.join(ctx.sandboxRoot, "business-validation.md");
    await fs.writeFile(reportPath, `# Business Validation — ${opp.title}\n\n**Overall: ${overallScore}/100 → ${recommendation}**\n\n## Scores\n- Demand: ${scores.demandScore}\n- Competition: ${scores.competitionScore}\n- Timing: ${scores.timingScore}\n- Feasibility: ${scores.feasibilityScore}\n- Monetization: ${scores.monetizationScore}\n\n## Risks\n${scores.risks.map((r) => `- ${r}`).join("\n")}\n\n## Channels\n${scores.channels.map((c) => `- ${c}`).join("\n")}\n`, "utf8");
    const stat = await fs.stat(reportPath);

    return {
      summary: `Validated ${opp.title}: ${overallScore}/100 → ${recommendation}`,
      artifacts: [{ type: "REPORT", path: reportPath, description: "Business validation report", size: stat.size }],
      output: { opportunityId: opp.opportunityId, overallScore, recommendation, validationId: validation.id, scores },
    };
  }
}
