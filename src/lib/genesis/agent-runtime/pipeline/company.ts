/** V8 G0 — Integrated Autonomous Venture Pipeline.
 *
 * The acceptance-test flow: "create a company without giving an idea."
 *
 *   DISCOVER (OPPORTUNITY agent — optional market focus, never a prescribed idea)
 *     → AEGIS-backed VENTURE analysis (asserts the market claim from real sources)
 *     → CUSTOMER simulation (SIMULATION-labelled reality score)
 *     → AI BOARDROOM debate over the full quantified context
 *     → build gate: MVP build only on GO/CONDITIONAL (NO_GO halts honestly)
 *
 * This module adds NO new intelligence — it is pure connection of the verified
 * V4–V7 layers, so every honesty label (HEURISTIC / SIMULATION / UNSUPPORTED)
 * carries through into one VentureRun record + VENTURE_RUN.md artifact.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { db } from "@/lib/db";
import { getAgent } from "../agents";
import { conveneBoard, type BoardDecisionResult } from "../boardroom";
import { verifySubject } from "../aegis";
import { dispatchGoal, type DispatchResult } from "../orchestrator";
import { getMemoryEngine } from "../memory/engine";
import { emit } from "../event-bus";

export interface CreateCompanyOptions {
  /** Optional market focus (e.g. "developer tools"). Discovery still runs — this is a lens, not an idea. */
  focus?: string;
  /** Skip discovery and run the pipeline on an existing opportunity. */
  opportunityId?: string;
  personaCount?: number; // default 200
  /** Run the MVP build when the board approves (default true). false = stop after the board (PLANNED). */
  build?: boolean;
  /** Halt on a board NO_GO (default true). */
  enforceBoard?: boolean;
  projectId?: string;
}

interface StageLog { stage: string; ms: number; summary: string; labels: string[] }

export interface CompanyRunResult {
  runId: string;
  status: "PLANNED" | "BUILT" | "HALTED_NO_GO" | "FAILED";
  stage: string;
  opportunity?: { opportunityId: string; title: string; problem: string };
  ventureScore: number;
  ventureVerdict?: string;
  truthScore: number;
  customerRealityScore: number;
  buyRate: number;
  board?: BoardDecisionResult;
  companyKey?: string;
  build?: DispatchResult;
  mode: string;
  stages: StageLog[];
  artifactPath?: string;
  error?: string;
}

async function nextRunId(): Promise<string> {
  const rows = await db.ventureRun.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { runId: true } });
  let max = 0;
  for (const r of rows) { const m = r.runId.match(/^RUN-(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `RUN-${(max + 1).toString().padStart(6, "0")}`;
}

export async function createCompany(opts: CreateCompanyOptions = {}): Promise<CompanyRunResult> {
  const runId = await nextRunId();
  const stages: StageLog[] = [];
  const t0 = Date.now();
  let stage = "DISCOVER";
  const log = (s: string, start: number, summary: string, labels: string[] = []) =>
    stages.push({ stage: s, ms: Date.now() - start, summary: summary.slice(0, 200), labels });

  await db.ventureRun.create({ data: { runId, focus: opts.focus ?? null, status: "RUNNING", stage } });
  await emit({ agent: "PIPELINE", action: "RUN_START", detail: `${runId}: autonomous venture run${opts.focus ? ` (focus: ${opts.focus})` : " (no idea given)"}`, level: "INFO", category: "DECISION" });

  const fail = async (error: string): Promise<CompanyRunResult> => {
    await db.ventureRun.update({ where: { runId }, data: { status: "FAILED", stage, error, stages: JSON.stringify(stages) } }).catch(() => {});
    await emit({ agent: "PIPELINE", action: "RUN_FAILED", detail: `${runId} failed at ${stage}: ${error.slice(0, 140)}`, level: "ERROR", category: "DECISION" });
    return { runId, status: "FAILED", stage, ventureScore: 0, truthScore: 0, customerRealityScore: 0, buyRate: 0, mode: "HEURISTIC", stages, error };
  };

  try {
    // ---- 1. DISCOVER ------------------------------------------------------
    let opp: { opportunityId: string; title: string; problem: string; difficulty: number; potentialValue: number } | null = null;
    {
      const s = Date.now();
      if (opts.opportunityId) {
        const row = await db.opportunity.findUnique({ where: { opportunityId: opts.opportunityId } });
        if (!row) return fail(`opportunity ${opts.opportunityId} not found`);
        opp = row;
        log("DISCOVER", s, `using existing opportunity ${row.opportunityId}: ${row.title}`);
      } else {
        const r = await getAgent("OPPORTUNITY")!.execute({ goal: opts.focus ?? "emerging unmet market problems", context: opts.focus ? { focus: opts.focus } : {} });
        if (r.status !== "SUCCESS") return fail(`discovery failed: ${r.error ?? r.summary}`);
        const created = (r.output.opportunities as { opportunityId: string }[]) ?? [];
        if (!created.length) return fail("discovery produced no opportunities");
        const rows = await db.opportunity.findMany({ where: { opportunityId: { in: created.map((o) => o.opportunityId) } } });
        rows.sort((a, b) => b.confidence * b.potentialValue - a.confidence * a.potentialValue);
        opp = rows[0];
        log("DISCOVER", s, `discovered ${rows.length}, selected ${opp.opportunityId}: ${opp.title}`, r.output.evidenceCount === 0 ? ["NO_WEB_EVIDENCE"] : []);
      }
    }

    // ---- 2. VENTURE (asserts the AEGIS market claim internally) -----------
    stage = "VENTURE";
    let venture: { ventureScore: number; verdict: string; growthPotential: number; competition: number; mode: string; truthScore: number };
    {
      const s = Date.now();
      const r = await getAgent("VENTURE")!.execute({ goal: `venture analysis: ${opp.title}`, context: { opportunityId: opp.opportunityId } });
      if (r.status !== "SUCCESS") return fail(`venture analysis failed: ${r.error ?? r.summary}`);
      venture = r.output as typeof venture;
      log("VENTURE", s, `VENTURE_SCORE ${venture.ventureScore}/100 → ${venture.verdict}`, [venture.mode]);
    }

    // ---- 3. CUSTOMER SIMULATION (SIMULATION-labelled) ----------------------
    stage = "CUSTOMER";
    let customer: { customerRealityScore: number; buyRate: number; personaCount: number; mode: string };
    {
      const s = Date.now();
      const r = await getAgent("CUSTOMER")!.execute({ goal: `customer reality: ${opp.title}`, context: { opportunityId: opp.opportunityId, personaCount: opts.personaCount ?? 200 } });
      if (r.status !== "SUCCESS") return fail(`customer simulation failed: ${r.error ?? r.summary}`);
      customer = r.output as typeof customer;
      log("CUSTOMER", s, `${customer.personaCount} personas → ${customer.buyRate}% buy, reality ${customer.customerRealityScore}/100`, ["SIMULATION", customer.mode]);
    }

    // ---- 4. AEGIS aggregate + BOARD ----------------------------------------
    stage = "BOARD";
    const truth = await verifySubject(opp.opportunityId);
    const board = await conveneBoard({
      topic: opp.title,
      question: `Should Genesis build and operate a company around: "${opp.title}"?`,
      context: {
        opportunityId: opp.opportunityId, problem: opp.problem,
        ventureScore: venture.ventureScore, growthPotential: venture.growthPotential, competition: venture.competition,
        truthScore: truth.overallTruth, customerRealityScore: customer.customerRealityScore, buyRate: customer.buyRate,
        difficulty: opp.difficulty,
      },
      projectId: opts.projectId, missionId: runId,
    });
    log("BOARD", t0, `${board.verdict} (${board.confidence}%) — ${board.tally.GO}GO/${board.tally.NO_GO}NO/${board.tally.ABSTAIN}AB`, [board.mode]);

    const mode = [venture.mode, customer.mode, board.mode].includes("LLM") ? "MIXED" : "HEURISTIC";

    // ---- 5. GATE + BUILD ----------------------------------------------------
    let status: CompanyRunResult["status"];
    let companyKey: string | undefined;
    let build: DispatchResult | undefined;

    if (board.verdict === "NO_GO" && opts.enforceBoard !== false) {
      status = "HALTED_NO_GO";
      await emit({ agent: "PIPELINE", action: "HALT", detail: `${runId}: board NO_GO (${board.confidence}%) — no build`, level: "WARNING", category: "DECISION" });
    } else {
      companyKey = `co-${opp.opportunityId.toLowerCase()}`;
      await db.company.upsert({
        where: { key: companyKey },
        create: { key: companyKey, name: opp.title.slice(0, 80), mission: opp.problem.slice(0, 300), status: "ACTIVE", strategy: JSON.stringify({ runId, ventureScore: venture.ventureScore, boardVerdict: board.verdict, conditions: board.conditions }) },
        update: { strategy: JSON.stringify({ runId, ventureScore: venture.ventureScore, boardVerdict: board.verdict, conditions: board.conditions }) },
      });
      if (opts.build !== false) {
        stage = "BUILD";
        // Board already debated — skip the advisory board inside dispatchGoal.
        build = await dispatchGoal(`Build an MVP for: ${opp.title} — ${opp.problem}`, { projectId: opts.projectId, board: false });
        status = "BUILT";
        log("BUILD", t0, build.summary);
      } else {
        status = "PLANNED";
      }
    }

    // ---- 6. RECORD + ARTIFACT + MEMORY --------------------------------------
    const artifactDir = path.resolve(process.cwd(), ".genesis-workspace", "pipeline", runId);
    await fs.mkdir(artifactDir, { recursive: true });
    const artifactPath = path.join(artifactDir, "VENTURE_RUN.md");
    await fs.writeFile(artifactPath, renderMarkdown({ runId, focus: opts.focus, opp, venture, customer, truth: truth.overallTruth, board, status, companyKey, build, mode, stages }), "utf8");

    await db.ventureRun.update({
      where: { runId },
      data: {
        status, stage, opportunityId: opp.opportunityId, opportunityTitle: opp.title,
        ventureScore: venture.ventureScore, ventureVerdict: venture.verdict, truthScore: truth.overallTruth,
        customerRealityScore: customer.customerRealityScore, buyRate: customer.buyRate,
        boardVerdict: board.verdict, boardConfidence: board.confidence,
        companyKey: companyKey ?? null, buildSummary: build?.summary ?? null,
        mode, stages: JSON.stringify(stages), artifactPath,
      },
    });
    await getMemoryEngine().record({
      type: "EPISODIC",
      title: `Venture run ${runId}: ${opp.title} → ${status}`,
      content: `Venture ${venture.ventureScore} (${venture.verdict}), truth ${truth.overallTruth}%, customer reality ${customer.customerRealityScore} (${customer.buyRate}% buy), board ${board.verdict} ${board.confidence}%. Mode ${mode}.`,
      tags: ["pipeline", "venture-run", status.toLowerCase()],
      importance: 9,
      source: `PIPELINE:${runId}`,
    });
    await emit({ agent: "PIPELINE", action: "RUN_DONE", detail: `${runId}: ${status} — ${opp.title} (board ${board.verdict})`, level: status === "HALTED_NO_GO" ? "WARNING" : "SUCCESS", category: "DECISION" });

    return {
      runId, status, stage,
      opportunity: { opportunityId: opp.opportunityId, title: opp.title, problem: opp.problem },
      ventureScore: venture.ventureScore, ventureVerdict: venture.verdict,
      truthScore: truth.overallTruth, customerRealityScore: customer.customerRealityScore, buyRate: customer.buyRate,
      board, companyKey, build, mode, stages, artifactPath,
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

function renderMarkdown(d: { runId: string; focus?: string; opp: { opportunityId: string; title: string; problem: string }; venture: { ventureScore: number; verdict: string; mode: string }; customer: { customerRealityScore: number; buyRate: number; personaCount: number }; truth: number; board: BoardDecisionResult; status: string; companyKey?: string; build?: DispatchResult; mode: string; stages: StageLog[] }): string {
  const banner = d.mode === "HEURISTIC"
    ? "> ⚠️ **HEURISTIC MODE — no LLM configured.** Every intelligence stage below reasoned by labelled rules; customer numbers are SIMULATION. Set `ANTHROPIC_API_KEY` for real reasoning.\n"
    : "> ℹ️ **MIXED MODE** — at least one stage used the LLM provider; the rest are labelled heuristics.\n";
  return [
    `# VENTURE_RUN — ${d.runId}`, "", banner,
    `**Focus given:** ${d.focus ?? "_none — autonomous discovery_"}  `,
    `**Opportunity:** ${d.opp.opportunityId} — ${d.opp.title}  `,
    `**Problem:** ${d.opp.problem}`, "",
    `| Gate | Result |`, `|---|---|`,
    `| VENTURE_SCORE | ${d.venture.ventureScore}/100 → ${d.venture.verdict} |`,
    `| AEGIS truth (subject) | ${d.truth}% |`,
    `| CUSTOMER_REALITY (SIMULATION) | ${d.customer.customerRealityScore}/100 (${d.customer.buyRate}% buy of ${d.customer.personaCount} personas) |`,
    `| BOARD | ${d.board.verdict} (${d.board.confidence}%) — ${d.board.tally.GO}GO/${d.board.tally.NO_GO}NO/${d.board.tally.ABSTAIN}AB |`,
    `| Outcome | **${d.status}**${d.companyKey ? ` — company \`${d.companyKey}\`` : ""} |`, "",
    ...(d.board.conditions.length ? [`## Board conditions`, ...d.board.conditions.map((c) => `- [ ] ${c}`), ""] : []),
    ...(d.build ? [`## Build`, d.build.summary, ""] : []),
    `## Stage log`, ...d.stages.map((s) => `- **${s.stage}** (${s.ms}ms)${s.labels.length ? ` [${s.labels.join(", ")}]` : ""}: ${s.summary}`),
  ].join("\n");
}
