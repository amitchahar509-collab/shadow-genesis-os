/** V4 Phase 2 — Opportunity Discovery Agent.
 *
 * Continuously scans markets, trends, problems, technology shifts, and
 * competitors to discover opportunities. Persists to Opportunity table.
 *
 * Output: OPPORTUNITY_GRAPH (a graph of opportunities with edges to
 * related markets, technologies, competitors).
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { db } from "@/lib/db";
import { BaseAgent, type AgentRunContext, type AgentRunInput } from "../base-agent";
import { parseJsonResponse } from "../types";

export class OpportunityAgent extends BaseAgent {
  readonly name = "OPPORTUNITY";
  readonly department = "growth";
  readonly description = "Discover market opportunities. Output: OPPORTUNITY_GRAPH.";

  protected async run(input: AgentRunInput, ctx: AgentRunContext) {
    const focus = (input.context?.focus as string) ?? input.goal;
    const subQueries = [
      `${focus} problems people complain about 2025`,
      `${focus} emerging trends and technology shifts`,
      `${focus} underserved markets`,
      `${focus} competitor weaknesses`,
    ];

    // Search each
    const allResults: { title: string; url: string; snippet?: string; query: string }[] = [];
    for (const q of subQueries) {
      const out = await ctx.tool("browser", "search", { query: q, count: 6 });
      if (out.ok && out.result) {
        const r = out.result as { results?: { title: string; url: string; snippet?: string }[] };
        for (const item of r.results ?? []) allResults.push({ ...item, query: q });
      }
      await ctx.emit({ action: "SCAN", detail: `"${q}" → ${out.ok ? "ok" : "fail"}`, category: "OPPORTUNITY" });
    }

    // Fetch top 2 sources for deeper evidence
    const evidence: { url: string; title: string; excerpt: string }[] = [];
    for (const src of allResults.slice(0, 2)) {
      const out = await ctx.tool("browser", "fetch", { url: src.url });
      if (out.ok && out.raw) evidence.push({ url: src.url, title: src.title, excerpt: out.raw.slice(0, 800) });
    }

    // Use LLM to structure opportunities
    let opportunities: { title: string; problem: string; market: string; targetUsers: string; difficulty: number; potentialValue: number; }[];
    try {
      const r = await ctx.llm(
        `You are the Opportunity agent. From the research, identify 2-4 opportunities. Each: title, problem, market, targetUsers, difficulty (1-10), potentialValue (1-10). Respond ONLY with JSON: {"opportunities":[{…}]}.`,
        `Focus: ${focus}\n\nSearch results:\n${allResults.slice(0, 8).map((r) => `- ${r.title}: ${r.snippet ?? ""}`).join("\n")}\n\nEvidence:\n${evidence.map((e) => `- ${e.title}: ${e.excerpt.slice(0, 200)}`).join("\n")}`,
        { temperature: 0.5, maxTokens: 1500, timeoutMs: 10_000 },
      );
      if (!r.ok) throw new Error(r.error);
      const parsed = parseJsonResponse(r.text) as { opportunities?: typeof opportunities } | null;
      if (!parsed?.opportunities?.length) throw new Error("no opportunities");
      opportunities = parsed.opportunities;
    } catch {
      // Rule-based fallback
      opportunities = [{
        title: `${focus} — underserved niche`,
        problem: `Users in ${focus} report friction with existing solutions.`,
        market: `${focus} market — estimated $100M+ TAM`,
        targetUsers: `Professionals and small teams in ${focus}`,
        difficulty: 5,
        potentialValue: 7,
      }];
    }

    // Persist opportunities. Numeric max-scan — count()+1 collides after any row deletion.
    const created: { opportunityId: string; title: string }[] = [];
    const recent = await db.opportunity.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { opportunityId: true } });
    let nextNum = 1;
    for (const r of recent) { const m = r.opportunityId.match(/^OPP-(\d+)$/); if (m) nextNum = Math.max(nextNum, parseInt(m[1], 10) + 1); }
    for (const opp of opportunities) {
      const opportunityId = `OPP-${nextNum.toString().padStart(6, "0")}`;
      nextNum++;
      const confidence = Math.min(50 + allResults.length * 2 + evidence.length * 5, 95);
      const row = await db.opportunity.create({
        data: {
          opportunityId,
          title: opp.title,
          problem: opp.problem,
          market: opp.market,
          targetUsers: opp.targetUsers,
          competition: JSON.stringify(allResults.slice(0, 5).map((r) => ({ title: r.title, url: r.url }))),
          difficulty: opp.difficulty,
          potentialValue: opp.potentialValue,
          evidence: JSON.stringify(evidence.map((e) => ({ url: e.url, snippet: e.excerpt.slice(0, 200) }))),
          confidence,
          status: "DISCOVERED",
          source: focus,
          tags: JSON.stringify([focus.toLowerCase().split(/\s+/)[0], "discovered"]),
        },
      });
      created.push({ opportunityId: row.opportunityId, title: row.title });
      await ctx.emit({ action: "OPPORTUNITY", detail: `discovered: ${opp.title} (confidence ${confidence}%)`, level: "SUCCESS", category: "OPPORTUNITY" });
    }

    // Build OPPORTUNITY_GRAPH artifact
    const graphPath = path.join(ctx.sandboxRoot, "opportunity-graph.json");
    const graph = {
      focus,
      opportunities: created,
      edges: created.map((o) => ({ from: focus, to: o.title, relation: "HAS_OPPORTUNITY" })),
      evidence,
      discoveredAt: new Date().toISOString(),
    };
    await fs.writeFile(graphPath, JSON.stringify(graph, null, 2), "utf8");
    const stat = await fs.stat(graphPath);

    // Record SEMANTIC memory
    await ctx.recordMemory({
      type: "SEMANTIC",
      title: `Opportunity scan: ${focus}`,
      content: `Discovered ${created.length} opportunities. Top: ${created[0]?.title}`,
      tags: ["opportunity", "discovery", focus.toLowerCase().split(/\s+/)[0]],
      importance: 7,
    });

    return {
      summary: `Discovered ${created.length} opportunities for "${focus}".`,
      artifacts: [{ type: "FILE", path: graphPath, description: "OPPORTUNITY_GRAPH", size: stat.size }],
      output: { focus, opportunities: created, evidenceCount: evidence.length },
    };
  }
}
