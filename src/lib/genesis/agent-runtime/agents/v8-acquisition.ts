/** V8 G4 — Autonomous Acquisition Engine.
 *
 * Runs the growth loop for a subject (opportunity/company):
 *
 *   HYPOTHESIS → EXPERIMENT → MEASURE → LEARNING → NEXT EXPERIMENT
 *
 * One call = one cycle. The experiment ladder advances from recorded history
 * (that history IS the experiment memory — what worked, what failed, why):
 *
 *   1. PRICING  — test 3 price points against the seeded Digital Customer
 *                 Simulation; winner by revenue proxy (buyRate × price).
 *   2. AUDIENCE — find the highest-converting simulated segment at the
 *                 winning price.
 *   3. CHANNEL  — propose a real outreach experiment targeting that segment.
 *                 This is a REAL external action: it goes through the Approval
 *                 Control Center and NEVER fabricates results — without real
 *                 channel execution + telemetry its measurement stays empty.
 *
 * Honesty (FORBIDDEN: fake users/growth/conversions): every measurement
 * carries `dataSource: SIMULATION | REAL | NONE`. Simulated buy-rates are
 * clearly labelled and are deliberately NOT written into GrowthMetric (that
 * table implies real telemetry). REAL measurements arrive only via the future
 * reality-feedback layer.
 */

import { db } from "@/lib/db";
import { BaseAgent, type AgentRunContext, type AgentRunInput } from "../base-agent";
import { CustomerSimulationAgent } from "./v7-customer"; // direct import — avoids a registry↔agent circular import
import { guardExternalAction } from "../approvals";

interface PricePoint { price: number; buyRate: number; realityScore: number; avgWTP: number; revenueProxy: number }

export class AcquisitionAgent extends BaseAgent {
  readonly name = "ACQUISITION";
  readonly department = "growth";
  readonly description = "Growth experiment loop: hypothesis → simulate/measure → learn → next. External actions require approval.";

  protected async run(input: AgentRunInput, ctx: AgentRunContext) {
    const c = input.context ?? {};
    const opportunityId = (c.opportunityId as string) ?? undefined;
    const opp = opportunityId ? await db.opportunity.findUnique({ where: { opportunityId } }) : null;
    const subject = opportunityId ?? (typeof c.subject === "string" ? c.subject : input.goal.slice(0, 80));
    const simSubject = opp?.title ?? subject;
    const potentialValue = numOr(opp?.potentialValue ?? c.potentialValue, 5);
    const competition = numOr(c.competition, 5);
    const personaCount = numOr(c.personaCount, 150);
    const basePrice = numOr(c.price, 30 + potentialValue * 10);

    // Experiment memory: the recorded history decides the next hypothesis.
    const history = await db.growthExperiment.findMany({ where: { subject, experimentId: { not: null } }, orderBy: { createdAt: "asc" } });
    const learned = (kind: string) => history.find((e) => e.kind === kind && e.status === "LEARNED");
    // KILLED channel experiments stay in memory as learnings but don't block a new proposal.
    const channelExp = history.filter((e) => e.kind === "CHANNEL").find((e) => e.status !== "KILLED");

    // --- CHANNEL experiment in flight: report state honestly, never fabricate. ---
    if (channelExp && channelExp.status !== "LEARNED") {
      const approval = channelExp.approvalId ? await db.approvalRequest.findUnique({ where: { requestId: channelExp.approvalId } }) : null;
      if (approval?.status === "PENDING") {
        return this.report(ctx, subject, channelExp.experimentId!, "CHANNEL", "AWAITING_APPROVAL", "NONE",
          `Channel experiment ${channelExp.experimentId} blocked on human approval (${channelExp.approvalId}). No results — no action has run.`,
          "human: decide the pending approval");
      }
      if (approval?.status === "REJECTED") {
        await db.growthExperiment.update({ where: { id: channelExp.id }, data: { status: "KILLED", learning: "Human rejected the outreach — channel experiment killed. Learning: this channel/message needs a different framing before retry.", endDate: new Date() } });
        return this.report(ctx, subject, channelExp.experimentId!, "CHANNEL", "KILLED", "NONE",
          `Channel experiment killed: approval ${channelExp.approvalId} was REJECTED.`, "propose a different channel or messaging");
      }
      if (approval && (approval.status === "APPROVED" || approval.status === "EXECUTED")) {
        if (channelExp.status !== "AWAITING_EXECUTION") {
          await db.growthExperiment.update({ where: { id: channelExp.id }, data: { status: "AWAITING_EXECUTION" } });
        }
        return this.report(ctx, subject, channelExp.experimentId!, "CHANNEL", "AWAITING_EXECUTION", "NONE",
          `Approved (${channelExp.approvalId}) — but Genesis has no live channel integration to execute the post, and it will not fabricate results. Measurement waits for real execution + telemetry.`,
          "integrate a real channel (reality-feedback layer) to measure");
      }
    }

    // --- Ladder step 1: PRICING (simulated A/B/C). ---
    if (!learned("PRICING")) {
      const prices = [Math.round(basePrice * 0.6), Math.round(basePrice), Math.round(basePrice * 1.4)];
      const points: PricePoint[] = [];
      for (const price of prices) {
        const r = await new CustomerSimulationAgent().execute({
          goal: `pricing probe $${price}: ${simSubject}`,
          context: { ...(opportunityId ? { opportunityId } : { subject: simSubject }), potentialValue, competition, personaCount, price },
          parentExecutionId: ctx.executionId,
        });
        if (r.status !== "SUCCESS") throw new Error(`pricing probe at $${price} failed: ${r.error}`);
        const o = r.output as { buyRate: number; customerRealityScore: number; avgWillingnessToPay: number };
        points.push({ price, buyRate: o.buyRate, realityScore: o.customerRealityScore, avgWTP: o.avgWillingnessToPay, revenueProxy: Math.round(o.buyRate * price) / 100 });
      }
      const winner = [...points].sort((a, b) => b.revenueProxy - a.revenueProxy)[0];
      const learning = `[SIMULATION] Price test ${points.map((p) => `$${p.price}→${p.buyRate}% buy`).join(", ")}. Winner $${winner.price} by revenue proxy (${winner.revenueProxy}/persona·100). Simulated personas, not real buyers.`;
      const experimentId = await this.persist(subject, {
        kind: "PRICING", name: `Pricing test: ${simSubject}`, metric: "sim_revenue_proxy",
        hypothesis: `A price near $${basePrice} maximizes simulated revenue for "${simSubject}"`,
        status: "LEARNED", dataSource: "SIMULATION", learning,
        result: { points, winner: winner.price, personaCount }, nextAction: "AUDIENCE experiment at the winning price",
      });
      await ctx.recordMemory({ type: "SEMANTIC", title: `Pricing learning: ${simSubject} → $${winner.price}`, content: learning, tags: ["acquisition", "pricing", "experiment"], importance: 7 });
      return this.report(ctx, subject, experimentId, "PRICING", "LEARNED", "SIMULATION", learning, "run AUDIENCE experiment", { winnerPrice: winner.price });
    }

    // --- Ladder step 2: AUDIENCE (simulated segment comparison). ---
    if (!learned("AUDIENCE")) {
      const pricing = learned("PRICING")!;
      const winnerPrice = numOr((safeParse(pricing.result) as { winner?: number }).winner, basePrice);
      const r = await new CustomerSimulationAgent().execute({
        goal: `audience probe at $${winnerPrice}: ${simSubject}`,
        context: { ...(opportunityId ? { opportunityId } : { subject: simSubject }), potentialValue, competition, personaCount: Math.max(personaCount, 200), price: winnerPrice },
        parentExecutionId: ctx.executionId,
      });
      if (r.status !== "SUCCESS") throw new Error(`audience probe failed: ${r.error}`);
      const simId = (r.output as { simulationId: string }).simulationId;
      const sim = await db.customerSimulation.findUnique({ where: { simulationId: simId } });
      const segments = (safeParse(sim?.segments ?? "[]") as { industry: string; n: number; buyRate: number }[]).filter((s) => s.n >= 5);
      if (!segments.length) throw new Error("audience probe produced no segments with n≥5");
      const best = [...segments].sort((a, b) => b.buyRate - a.buyRate)[0];
      const worst = [...segments].sort((a, b) => a.buyRate - b.buyRate)[0];
      const learning = `[SIMULATION] Segment test at $${winnerPrice}: ${best.industry} converts best (${best.buyRate}%, n=${best.n}); ${worst.industry} worst (${worst.buyRate}%). Target ${best.industry} first. Simulated personas, not real buyers.`;
      const experimentId = await this.persist(subject, {
        kind: "AUDIENCE", name: `Audience test: ${simSubject}`, metric: "sim_segment_buy_rate",
        hypothesis: `Some industries convert materially better for "${simSubject}"`,
        status: "LEARNED", dataSource: "SIMULATION", learning,
        result: { price: winnerPrice, segments, winner: best.industry }, nextAction: "propose CHANNEL experiment targeting the winning segment",
      });
      await ctx.recordMemory({ type: "SEMANTIC", title: `Audience learning: ${simSubject} → ${best.industry}`, content: learning, tags: ["acquisition", "audience", "experiment"], importance: 7 });
      return this.report(ctx, subject, experimentId, "AUDIENCE", "LEARNED", "SIMULATION", learning, "propose CHANNEL experiment", { winnerSegment: best.industry });
    }

    // --- Ladder step 3: CHANNEL (real external action → approval queue). ---
    if (!channelExp) {
      const audience = learned("AUDIENCE")!;
      const segment = String((safeParse(audience.result) as { winner?: string }).winner ?? "early adopters");
      const description = `Publish an outreach post for "${simSubject}" in a ${segment}-focused community`;
      const gate = await guardExternalAction({ agent: this.name, executionId: ctx.executionId, actionType: "POST", description, payload: { subject, segment, kind: "community-post" } });
      const learning = `Channel experiment proposed targeting ${segment}. External action — blocked pending human approval (${gate.requestId}, risk ${gate.riskScore}). No results exist and none will be fabricated.`;
      const experimentId = await this.persist(subject, {
        kind: "CHANNEL", name: `Channel test: ${segment} community`, metric: "real_conversions",
        hypothesis: `${segment}-focused communities convert for "${simSubject}"`,
        status: "AWAITING_APPROVAL", dataSource: "NONE", learning: null,
        result: { proposed: description, segment }, approvalId: gate.requestId, nextAction: "human decision on the approval",
      });
      return this.report(ctx, subject, experimentId, "CHANNEL", "AWAITING_APPROVAL", "NONE", learning, `human: decide ${gate.requestId}`);
    }

    // --- Ladder complete. ---
    const summaryText = `Acquisition ladder complete for "${subject}": ${history.filter((e) => e.status === "LEARNED").length} learned experiment(s). Further learning needs real telemetry (reality-feedback layer).`;
    return this.report(ctx, subject, channelExp.experimentId!, "CHANNEL", channelExp.status, channelExp.dataSource, summaryText, "await real data");
  }

  private async persist(subject: string, data: { kind: string; name: string; metric: string; hypothesis: string; status: string; dataSource: string; learning: string | null; result: unknown; approvalId?: string; nextAction: string }): Promise<string> {
    const experimentId = `EXP-${(await nextExperimentNumber()).toString().padStart(6, "0")}`;
    await db.growthExperiment.create({
      data: {
        experimentId, subject, kind: data.kind, name: data.name, metric: data.metric, hypothesis: data.hypothesis,
        status: data.status, dataSource: data.dataSource, learning: data.learning, result: JSON.stringify(data.result),
        approvalId: data.approvalId ?? null, nextAction: data.nextAction,
        ...(data.status === "LEARNED" ? { endDate: new Date() } : {}),
      },
    });
    return experimentId;
  }

  private async report(ctx: AgentRunContext, subject: string, experimentId: string, kind: string, status: string, dataSource: string, learning: string, nextAction: string, extra: Record<string, unknown> = {}) {
    await ctx.emit({ action: "EXPERIMENT", detail: `${experimentId} [${kind}/${status}/${dataSource}]: ${learning.slice(0, 130)}`, level: status === "KILLED" ? "WARNING" : "SUCCESS", category: "GROWTH" });
    return {
      summary: `${kind} experiment ${experimentId}: ${status}. ${learning.slice(0, 140)}`,
      artifacts: [],
      output: { subject, experimentId, kind, status, dataSource, learning, nextAction, ...extra },
    };
  }
}

async function nextExperimentNumber(): Promise<number> {
  const rows = await db.growthExperiment.findMany({ where: { experimentId: { not: null } }, orderBy: { createdAt: "desc" }, take: 50, select: { experimentId: true } });
  let max = 0;
  for (const r of rows) { const m = r.experimentId?.match(/^EXP-(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return max + 1;
}

function numOr(v: unknown, d: number): number { return typeof v === "number" && Number.isFinite(v) ? v : d; }
function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return {}; } }
