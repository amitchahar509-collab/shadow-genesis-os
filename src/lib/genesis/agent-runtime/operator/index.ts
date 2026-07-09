/** Long-Horizon Operator (V8 G5) — operate companies for 30/60/90 days.
 *
 * Missions are persisted (`LongMission`) and advanced by ticks, not by a
 * long-running process — restart-safe by construction. A tick computes which
 * review loops are due from real timestamps and runs them:
 *
 *   DAILY   — analyze real metrics (executions, task failures, aging approvals)
 *             since the last daily; detected problems become GenesisTask rows.
 *   WEEKLY  — strategy re-check: re-run the Venture Analyst on the mission's
 *             opportunity and flag score drift.
 *   MONTHLY — SCALE / PIVOT / KILL / DOUBLE_DOWN, decided by the AI Boardroom
 *             over the mission's real trend numbers. KILL ends the mission and
 *             pauses the company.
 *   FINAL   — when the horizon ends, a closing review completes the mission.
 *
 * Honesty: every review's `metrics` snapshot comes from real DB rows; the tick
 * time (`asOf`) is injectable for tests/simulation and is recorded on the
 * review so simulated time can never masquerade as wall-clock history.
 * Ticks are driven by API/cron calls — there is no hidden daemon.
 */

import { db } from "@/lib/db";
import { getAgent } from "../agents";
import { nextTaskNumber } from "../agents/core";
import { conveneBoard } from "../boardroom";
import { getMemoryEngine } from "../memory/engine";
import { emit } from "../event-bus";

const DAY_MS = 24 * 60 * 60 * 1000;

export type MonthlyDecision = "SCALE" | "PIVOT" | "KILL" | "DOUBLE_DOWN";

export interface TickResult {
  missionId: string;
  status: string;
  ran: ("DAILY" | "WEEKLY" | "MONTHLY" | "FINAL")[];
  reviews: { kind: string; reviewId: string; summary: string; decision?: MonthlyDecision }[];
}

async function nextId(prefix: "LM" | "REV"): Promise<string> {
  const rows = prefix === "LM"
    ? await db.longMission.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { missionId: true } })
    : await db.operatorReview.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { reviewId: true } });
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const r of rows) { const id = "missionId" in r ? r.missionId : r.reviewId; const m = id.match(re); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `${prefix}-${(max + 1).toString().padStart(6, "0")}`;
}

export async function startLongMission(input: { goal: string; companyKey?: string; opportunityId?: string; horizonDays?: 30 | 60 | 90; now?: Date }) {
  const horizonDays = input.horizonDays ?? 30;
  const now = input.now ?? new Date();
  const missionId = await nextId("LM");
  const mission = await db.longMission.create({
    data: {
      missionId, goal: input.goal, companyKey: input.companyKey ?? null, opportunityId: input.opportunityId ?? null,
      horizonDays, status: "ACTIVE", startedAt: now, endsAt: new Date(now.getTime() + horizonDays * DAY_MS),
    },
  });
  await emit({ agent: "OPERATOR", action: "MISSION_START", detail: `${missionId}: ${horizonDays}-day mission — ${input.goal.slice(0, 100)}`, level: "INFO", category: "TASK" });
  return mission;
}

/** Advance one mission. `now` is injectable for tests/simulation (recorded as asOf). */
export async function tick(missionId: string, opts?: { now?: Date }): Promise<TickResult> {
  const now = opts?.now ?? new Date();
  const mission = await db.longMission.findUnique({ where: { missionId } });
  if (!mission) return { missionId, status: "NOT_FOUND", ran: [], reviews: [] };
  if (mission.status !== "ACTIVE") return { missionId, status: mission.status, ran: [], reviews: [] };

  const ran: TickResult["ran"] = [];
  const reviews: TickResult["reviews"] = [];
  const due = (last: Date | null, intervalMs: number) => now.getTime() - (last ?? mission.startedAt).getTime() >= intervalMs;

  // DAILY — first tick establishes the baseline; then once per elapsed day.
  if (!mission.lastDailyAt || due(mission.lastDailyAt, DAY_MS)) {
    const r = await dailyReview(mission, now);
    ran.push("DAILY"); reviews.push(r);
    await db.longMission.update({ where: { missionId }, data: { lastDailyAt: now } });
  }
  // WEEKLY — after 7 real elapsed days.
  if (due(mission.lastWeeklyAt, 7 * DAY_MS)) {
    const r = await weeklyReview(mission, now);
    ran.push("WEEKLY"); reviews.push(r);
    await db.longMission.update({ where: { missionId }, data: { lastWeeklyAt: now } });
  }
  // MONTHLY — after 30 elapsed days; may KILL the mission.
  let killed = false;
  let latestDecision = mission.monthlyDecision;
  if (due(mission.lastMonthlyAt, 30 * DAY_MS)) {
    const r = await monthlyReview(mission, now);
    ran.push("MONTHLY"); reviews.push(r);
    killed = r.decision === "KILL";
    latestDecision = r.decision ?? latestDecision;
    await db.longMission.update({ where: { missionId }, data: { lastMonthlyAt: now, monthlyDecision: r.decision ?? null, ...(killed ? { status: "KILLED" } : {}) } });
    if (killed && mission.companyKey) {
      await db.company.updateMany({ where: { key: mission.companyKey }, data: { status: "PAUSED" } });
    }
  }
  // FINAL — horizon reached (unless the monthly already killed it).
  if (!killed && now >= mission.endsAt) {
    const reviewId = await nextId("REV");
    const summary = `Horizon reached: ${mission.horizonDays}-day mission complete. Last monthly decision: ${latestDecision ?? "none"}.`;
    await db.operatorReview.create({ data: { reviewId, missionId, kind: "FINAL", asOf: now, summary, metrics: mission.metrics } });
    await db.longMission.update({ where: { missionId }, data: { status: "COMPLETED" } });
    ran.push("FINAL"); reviews.push({ kind: "FINAL", reviewId, summary });
    await emit({ agent: "OPERATOR", action: "MISSION_COMPLETE", detail: `${missionId}: ${summary}`, level: "SUCCESS", category: "TASK" });
  }

  const fresh = await db.longMission.findUnique({ where: { missionId }, select: { status: true } });
  return { missionId, status: fresh?.status ?? "ACTIVE", ran, reviews };
}

/** Tick every ACTIVE mission — the cron/API entry point. */
export async function tickAll(opts?: { now?: Date }): Promise<TickResult[]> {
  const active = await db.longMission.findMany({ where: { status: "ACTIVE" }, select: { missionId: true } });
  const results: TickResult[] = [];
  for (const m of active) results.push(await tick(m.missionId, opts));
  return results;
}

// ---------------------------------------------------------------------------

type Mission = NonNullable<Awaited<ReturnType<typeof db.longMission.findUnique>>>;

/** DAILY: real metrics since the last daily; problems become improvement tasks. */
async function dailyReview(mission: Mission, now: Date) {
  const since = mission.lastDailyAt ?? mission.startedAt;
  const [executions, failures, failedTasks, agingApprovals] = await Promise.all([
    db.agentExecution.count({ where: { startedAt: { gte: since } } }),
    db.agentExecution.count({ where: { startedAt: { gte: since }, status: "FAILED" } }),
    db.genesisTask.count({ where: { updatedAt: { gte: since }, status: "FAILED" } }),
    db.approvalRequest.count({ where: { status: "PENDING", requestedAt: { lt: new Date(now.getTime() - DAY_MS) } } }),
  ]);

  const findings: string[] = [];
  const actions: string[] = [];
  if (failures > 0) {
    findings.push(`${failures} failed execution(s) since last daily`);
    // Real corrective action: an improvement task for QUALITY.
    const taskId = `T-${(await nextTaskNumber()).toString().padStart(3, "0")}`;
    await db.genesisTask.create({
      data: {
        taskId, title: `Investigate ${failures} failed execution(s) [${mission.missionId}]`,
        description: `Daily operator review found ${failures} FAILED AgentExecution row(s) since ${since.toISOString()}. Diagnose root causes and fix.`,
        ownerAgent: "QUALITY", department: "quality", priority: "HIGH", status: "PENDING",
        dependencies: "[]", expectedArtifact: "failure analysis", validation: "root causes identified", estimatedHours: 1,
      },
    });
    actions.push(`created ${taskId} (QUALITY)`);
  }
  if (failedTasks > 0) findings.push(`${failedTasks} task(s) in FAILED state`);
  if (agingApprovals > 0) findings.push(`${agingApprovals} approval(s) pending >24h — human attention needed`);

  const metrics = { since: since.toISOString(), executions, failures, failedTasks, agingApprovals };
  const reviewId = await nextId("REV");
  const summary = findings.length ? `Daily: ${findings.join("; ")}.` : `Daily: healthy — ${executions} execution(s), 0 failures.`;
  await db.operatorReview.create({ data: { reviewId, missionId: mission.missionId, kind: "DAILY", asOf: now, summary, findings: JSON.stringify(findings), actions: JSON.stringify(actions), metrics: JSON.stringify(metrics) } });
  await emit({ agent: "OPERATOR", action: "DAILY_REVIEW", detail: `${mission.missionId}: ${summary.slice(0, 140)}`, level: findings.length ? "WARNING" : "INFO", category: "TASK" });
  return { kind: "DAILY", reviewId, summary };
}

/** WEEKLY: re-run the Venture Analyst (strategy) and one acquisition cycle (growth results). */
async function weeklyReview(mission: Mission, now: Date) {
  const findings: string[] = [];
  const state = safeParse(mission.metrics) as Record<string, unknown>;
  let ventureScore: number | undefined;
  let growth: string | undefined;

  if (mission.opportunityId) {
    const r = await getAgent("VENTURE")!.execute({ goal: `weekly strategy re-check: ${mission.goal}`, context: { opportunityId: mission.opportunityId } });
    if (r.status === "SUCCESS") {
      ventureScore = (r.output as { ventureScore: number }).ventureScore;
      const prev = typeof state.lastVentureScore === "number" ? state.lastVentureScore : undefined;
      if (prev !== undefined && ventureScore < prev - 10) findings.push(`venture score dropped ${prev} → ${ventureScore}`);
      else if (prev !== undefined && ventureScore > prev + 10) findings.push(`venture score improved ${prev} → ${ventureScore}`);
      await db.longMission.update({ where: { missionId: mission.missionId }, data: { metrics: JSON.stringify({ ...state, lastVentureScore: ventureScore }) } });
    } else {
      findings.push(`weekly venture re-check failed: ${r.error ?? r.summary}`);
    }
    // Growth results: advance the acquisition experiment ladder one cycle.
    try {
      const g = await getAgent("ACQUISITION")!.execute({ goal: `weekly growth cycle: ${mission.goal}`, context: { opportunityId: mission.opportunityId, personaCount: 120 } });
      if (g.status === "SUCCESS") {
        const out = g.output as { experimentId: string; kind: string; status: string; learning: string };
        growth = `${out.experimentId} [${out.kind}/${out.status}]`;
        findings.push(`growth: ${out.learning.slice(0, 160)}`);
      } else {
        findings.push(`growth cycle failed: ${g.error ?? g.summary}`);
      }
    } catch (e) {
      findings.push(`growth cycle error: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    findings.push("no opportunity linked — strategy re-check skipped");
  }

  const reviewId = await nextId("REV");
  const summary = `Weekly strategy review${ventureScore !== undefined ? `: venture ${ventureScore}/100` : ""}${growth ? `, ${growth}` : ""}${findings.length ? ` — ${findings.join("; ")}` : ""}.`;
  await db.operatorReview.create({ data: { reviewId, missionId: mission.missionId, kind: "WEEKLY", asOf: now, summary, findings: JSON.stringify(findings), metrics: JSON.stringify({ ventureScore, growthExperiment: growth }) } });
  await emit({ agent: "OPERATOR", action: "WEEKLY_REVIEW", detail: `${mission.missionId}: ${summary.slice(0, 140)}`, level: "INFO", category: "TASK" });
  return { kind: "WEEKLY", reviewId, summary };
}

/** MONTHLY: the boardroom decides SCALE / PIVOT / KILL / DOUBLE_DOWN from real trend numbers. */
async function monthlyReview(mission: Mission, now: Date) {
  const state = safeParse(mission.metrics) as Record<string, unknown>;
  const [doneTasks, failedTasks] = await Promise.all([
    db.genesisTask.count({ where: { updatedAt: { gte: mission.startedAt }, status: "DONE" } }),
    db.genesisTask.count({ where: { updatedAt: { gte: mission.startedAt }, status: "FAILED" } }),
  ]);
  const opp = mission.opportunityId ? await db.opportunity.findUnique({ where: { opportunityId: mission.opportunityId } }) : null;

  const board = await conveneBoard({
    topic: `Monthly review: ${mission.goal.slice(0, 100)}`,
    question: `Should Genesis continue operating "${mission.goal}" — and if so, scale it or change course?`,
    context: {
      missionId: mission.missionId, elapsedDays: Math.round((now.getTime() - mission.startedAt.getTime()) / DAY_MS),
      lastVentureScore: state.lastVentureScore, doneTasks, failedTasks,
      confidence: typeof state.lastVentureScore === "number" ? state.lastVentureScore : opp?.confidence ?? 50,
      potentialValue: opp?.potentialValue ?? 5, difficulty: opp?.difficulty ?? 5,
    },
    missionId: mission.missionId,
  });

  const decision: MonthlyDecision =
    board.verdict === "NO_GO" ? "KILL"
    : board.verdict === "CONDITIONAL" ? "PIVOT"
    : board.confidence >= 75 ? "DOUBLE_DOWN" : "SCALE";

  const reviewId = await nextId("REV");
  const summary = `Monthly: board ${board.verdict} (${board.confidence}%) → ${decision}.`;
  await db.operatorReview.create({ data: { reviewId, missionId: mission.missionId, kind: "MONTHLY", asOf: now, summary, findings: JSON.stringify(board.risks), actions: JSON.stringify([`decision: ${decision}`]), metrics: JSON.stringify({ doneTasks, failedTasks, lastVentureScore: state.lastVentureScore }), decision } });
  await getMemoryEngine().record({
    type: "EPISODIC", title: `Monthly decision ${mission.missionId}: ${decision}`,
    content: `${summary} Goal: ${mission.goal}. Done ${doneTasks}, failed ${failedTasks}, venture ${state.lastVentureScore ?? "n/a"}.`,
    tags: ["operator", "monthly", decision.toLowerCase()], importance: 9, source: `OPERATOR:${mission.missionId}`,
  });
  await emit({ agent: "OPERATOR", action: "MONTHLY_DECISION", detail: `${mission.missionId}: ${summary}`, level: decision === "KILL" ? "WARNING" : "SUCCESS", category: "DECISION" });
  return { kind: "MONTHLY", reviewId, summary, decision };
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return {}; } }
