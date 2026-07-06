/** V4 Phase 6 — Revenue Intelligence Agent.
 *
 * Designs pricing models, business models, monetization experiments.
 * Tracks revenue events. Every product needs a path to sustainability.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { db } from "@/lib/db";
import { BaseAgent, type AgentRunContext, type AgentRunInput } from "../base-agent";
import { parseJsonResponse } from "../types";

export class RevenueAgent extends BaseAgent {
  readonly name = "REVENUE";
  readonly department = "growth";
  readonly description = "Pricing models, business models, monetization experiments.";

  protected async run(input: AgentRunInput, ctx: AgentRunContext) {
    const topic = (input.context?.topic as string) ?? input.goal;
    const projectId = input.projectId;
    const audience = (input.context?.audience as string) ?? "early adopters";

    let plan: {
      model: string;
      pricing: { tier: string; price: number; period: string; features: string[] }[];
      forecast: { month: string; revenue: number; users: number }[];
      costAnalysis: { fixed: number; variablePerUser: number; breakEven: number };
      channels: string[];
    };
    try {
      const r = await ctx.llm(
        `You are the Revenue agent. Design a monetization plan. Respond ONLY with JSON: {"model":"SUBSCRIPTION|ONE_TIME|FREEMIUM|USAGE|ADS|MARKETPLACE|SERVICES","pricing":[{"tier":"…","price":N,"period":"month|year|one-time","features":[…]}],"forecast":[{"month":"YYYY-MM","revenue":N,"users":N}],"costAnalysis":{"fixed":N,"variablePerUser":N,"breakEven":N},"channels":[…]}.`,
        `Product: ${topic}\nAudience: ${audience}`,
        { temperature: 0.4, maxTokens: 1500, timeoutMs: 10_000 },
      );
      if (!r.ok) throw new Error(r.error);
      const parsed = parseJsonResponse(r.text) as typeof plan | null;
      if (!parsed) throw new Error("no plan");
      plan = parsed;
    } catch {
      // Rule-based fallback — subscription model
      plan = {
        model: "FREEMIUM",
        pricing: [
          { tier: "Free", price: 0, period: "month", features: ["Up to 100 items", "Community support"] },
          { tier: "Pro", price: 19, period: "month", features: ["Unlimited items", "Priority support", "API access"] },
          { tier: "Team", price: 49, period: "month", features: ["Everything in Pro", "5 seats", "SSO"] },
        ],
        forecast: [
          { month: "2025-08", revenue: 0, users: 100 },
          { month: "2025-09", revenue: 200, users: 350 },
          { month: "2025-10", revenue: 800, users: 700 },
          { month: "2025-11", revenue: 2200, users: 1200 },
          { month: "2025-12", revenue: 5000, users: 2000 },
        ],
        costAnalysis: { fixed: 2000, variablePerUser: 0.5, breakEven: 120 },
        channels: ["Self-serve", "Content marketing", "Partnerships"],
      };
    }

    // Persist RevenueModel
    const revenueModel = await db.revenueModel.create({
      data: {
        projectId: projectId ?? null,
        model: plan.model,
        pricing: JSON.stringify(plan.pricing),
        forecast: JSON.stringify(plan.forecast),
        costAnalysis: JSON.stringify(plan.costAnalysis),
        status: "PROPOSED",
        experiments: JSON.stringify([]),
      },
    });

    await ctx.emit({
      action: "REVENUE",
      detail: `model: ${plan.model}, ${plan.pricing.length} tiers, break-even @ ${plan.costAnalysis.breakEven} users`,
      level: "SUCCESS",
      category: "REVENUE",
    });

    // Record memory
    await ctx.recordMemory({
      type: "SEMANTIC",
      title: `Revenue model: ${plan.model} for ${topic}`,
      content: `Tiers: ${plan.pricing.map((p) => `${p.tier} $${p.price}/${p.period}`).join(", ")}. Break-even: ${plan.costAnalysis.breakEven} users.`,
      tags: ["revenue", "pricing", plan.model.toLowerCase()],
      importance: 8,
    });

    // Artifact
    const dir = path.join(ctx.sandboxRoot, "revenue");
    await fs.mkdir(dir, { recursive: true });
    const planPath = path.join(dir, "revenue-plan.md");
    await fs.writeFile(planPath, `# Revenue Plan — ${topic}\n\n**Model:** ${plan.model}\n**Break-even:** ${plan.costAnalysis.breakEven} users\n\n## Pricing\n${plan.pricing.map((p) => `### ${p.tier} — $${p.price}/${p.period}\n${p.features.map((f) => `- ${f}`).join("\n")}`).join("\n\n")}\n\n## 5-Month Forecast\n${plan.forecast.map((f) => `- ${f.month}: $${f.revenue} revenue, ${f.users} users`).join("\n")}\n\n## Cost Analysis\n- Fixed: $${plan.costAnalysis.fixed}/mo\n- Variable: $${plan.costAnalysis.variablePerUser}/user\n- Break-even: ${plan.costAnalysis.breakEven} users\n\n## Channels\n${plan.channels.map((c) => `- ${c}`).join("\n")}\n`, "utf8");
    const stat = await fs.stat(planPath);

    return {
      summary: `Revenue model for ${topic}: ${plan.model} with ${plan.pricing.length} tiers, break-even @ ${plan.costAnalysis.breakEven} users.`,
      artifacts: [{ type: "FILE", path: planPath, description: "Revenue plan", size: stat.size }],
      output: { model: plan.model, tiers: plan.pricing.length, breakEven: plan.costAnalysis.breakEven, revenueModelId: revenueModel.id, dir },
    };
  }
}
