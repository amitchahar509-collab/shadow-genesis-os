/** Benchmark Arena (V8 G12) — Genesis measures itself.
 *
 * A benchmark task exercises a real capability and asserts a KNOWN-CORRECT
 * outcome, then scores how well the system met it. The honest measure of an
 * intelligence layer in heuristic mode is DISCRIMINATION: does it rank a
 * genuinely strong case above a genuinely weak one, and refuse unsupported
 * confidence? Each task runs real code (real agents, real DB rows, real
 * timings) — nothing is mocked and no score is fabricated.
 *
 *   intelligence suite (fast, deterministic): EVIDENCE, VENTURE, CUSTOMER,
 *     BOARD, CHAIN — the reasoning + decision stack.
 *   full suite (+ heavy): BUILD — a real orchestrator mission.
 *
 * Scores rise automatically when an LLM key is added (reasoning replaces
 * heuristics); `mode` records the substrate each run was measured under, so a
 * heuristic score is never compared against an LLM score blindly.
 */

import { db } from "@/lib/db";
import { getAgent } from "../agents";
import { conveneBoard } from "../boardroom";
import { assertClaim, scoreEvidence } from "../aegis";
import { createCompany } from "../pipeline/company";
import { dispatchGoal } from "../orchestrator";
import { pickProvider } from "../types";
import { emit } from "../event-bus";

export interface TaskResult { id: string; capability: string; pass: boolean; score: number; ms: number; tokens: number; detail: string }
export interface BenchmarkResult {
  runId: string; suite: string; autonomyScore: number; successRate: number;
  totalTasks: number; passed: number; durationMs: number; avgTaskMs: number; tokensUsed: number; mode: string;
  results: TaskResult[];
}

interface BenchTask { id: string; capability: string; weight: number; run(): Promise<{ pass: boolean; score: number; tokens?: number; detail: string }> }

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
/** Reward correct ordering by margin: 60 for a correct call, +up to 40 for a clear gap. */
function orderingScore(strong: number, weak: number, span = 40): number {
  if (strong <= weak) return clamp(30 * (1 - Math.min(1, (weak - strong) / span))); // wrong: partial credit shrinks with the error
  return clamp(60 + 40 * Math.min(1, (strong - weak) / span));
}

const STRONG_OPP = { subject: "BENCH strong", potentialValue: 9, difficulty: 3, confidence: 88, competition: 2, evidenceCount: 6 };
const WEAK_OPP = { subject: "BENCH weak", potentialValue: 2, difficulty: 9, confidence: 12, competition: 9, evidenceCount: 0 };

const TASKS: BenchTask[] = [
  {
    id: "evidence-discrimination", capability: "EVIDENCE", weight: 1,
    async run() {
      // Multi-source support must clear SUPPORTED; zero evidence must be UNSUPPORTED at 0.
      const strong = scoreEvidence([
        { stance: "SUPPORT", summary: "a", source: "x", weight: 0.9 }, { stance: "SUPPORT", summary: "b", source: "y", weight: 0.9 },
        { stance: "SUPPORT", summary: "c", source: "z", weight: 0.8 }, { stance: "SUPPORT", summary: "d", source: "w", weight: 0.8 },
      ]);
      const none = scoreEvidence([]);
      const c1 = strong.verdict === "SUPPORTED";
      const c2 = none.verdict === "UNSUPPORTED" && none.truthScore === 0;
      const pass = c1 && c2;
      return { pass, score: (c1 ? 50 : 0) + (c2 ? 50 : 0), detail: `strong=${strong.verdict}(${strong.truthScore}), none=${none.verdict}(${none.truthScore})` };
    },
  },
  {
    id: "venture-discrimination", capability: "VENTURE", weight: 1,
    async run() {
      const s = await getAgent("VENTURE")!.execute({ goal: "bench strong", context: { ...STRONG_OPP } });
      const w = await getAgent("VENTURE")!.execute({ goal: "bench weak", context: { ...WEAK_OPP } });
      const ss = (s.output as { ventureScore: number }).ventureScore;
      const ws = (w.output as { ventureScore: number }).ventureScore;
      const tokens = (s.metrics.tokensUsed ?? 0) + (w.metrics.tokensUsed ?? 0);
      const score = orderingScore(ss, ws);
      return { pass: ss > ws, score, tokens, detail: `strong ${ss} vs weak ${ws} → ${ss > ws ? "correct" : "WRONG"}` };
    },
  },
  {
    id: "customer-discrimination", capability: "CUSTOMER", weight: 1,
    async run() {
      const s = await getAgent("CUSTOMER")!.execute({ goal: "bench strong", context: { ...STRONG_OPP, personaCount: 200, price: 30 } });
      const w = await getAgent("CUSTOMER")!.execute({ goal: "bench weak", context: { ...WEAK_OPP, personaCount: 200, price: 200 } });
      const sb = (s.output as { buyRate: number }).buyRate;
      const wb = (w.output as { buyRate: number }).buyRate;
      return { pass: sb > wb, score: orderingScore(sb, wb, 50), detail: `strong ${sb}% vs weak ${wb}% buy → ${sb > wb ? "correct" : "WRONG"}` };
    },
  },
  {
    id: "board-decision", capability: "BOARD", weight: 1.2,
    async run() {
      const s = await conveneBoard({ topic: "BENCH strong board", question: "build?", context: { ventureScore: 85, growthPotential: 88, competition: 90, truthScore: 70, customerRealityScore: 82, difficulty: 3 } });
      const w = await conveneBoard({ topic: "BENCH weak board", question: "build?", context: { ventureScore: 18, growthPotential: 15, competition: 10, truthScore: 0, customerRealityScore: 14, difficulty: 9 } });
      const c1 = s.verdict !== "NO_GO"; // a strong case must not be rejected
      const c2 = w.verdict !== "GO";     // a weak case must not be approved
      return { pass: c1 && c2, score: (c1 ? 50 : 0) + (c2 ? 50 : 0), detail: `strong→${s.verdict}, weak→${w.verdict}` };
    },
  },
  {
    id: "decision-chain", capability: "CHAIN", weight: 1.5,
    async run() {
      // A strong, evidence-backed opportunity must traverse all gates and NOT be halted.
      const oppId = `OPP-BENCHCHAIN-${Date.now()}`;
      await db.opportunity.create({ data: {
        opportunityId: oppId, title: "BENCH chain product", problem: "acute pain", market: "m", targetUsers: "u",
        potentialValue: 9, difficulty: 3, confidence: 85, competition: "[]", source: "bench",
        evidence: JSON.stringify([{ url: "https://a", snippet: "pain" }, { url: "https://b", snippet: "spend up" }, { url: "https://c", snippet: "underserved" }, { url: "https://d", snippet: "adoption" }, { url: "https://e", snippet: "growth" }]),
      } });
      try {
        const run = await createCompany({ opportunityId: oppId, personaCount: 120, build: false, operateDays: 0 });
        const gates = run.ventureScore > 0 && run.customerRealityScore > 0 && !!run.board;
        const notHalted = run.status !== "HALTED_NO_GO" && run.status !== "FAILED";
        const stages = run.stages.map((s) => s.stage);
        const reachedBoard = stages.includes("BOARD");
        const pass = gates && reachedBoard && notHalted;
        return { pass, score: (gates ? 34 : 0) + (reachedBoard ? 33 : 0) + (notHalted ? 33 : 0), detail: `status=${run.status}, stages=${stages.join(">")}, board=${run.board?.verdict}` };
      } finally {
        await db.claim.deleteMany({ where: { subject: oppId } }).catch(() => {});
        await db.ventureAnalysis.deleteMany({ where: { opportunityId: oppId } }).catch(() => {});
        await db.customerSimulation.deleteMany({ where: { opportunityId: oppId } }).catch(() => {});
        const run2 = await db.ventureRun.findFirst({ where: { opportunityId: oppId } });
        if (run2) await db.ventureRun.deleteMany({ where: { opportunityId: oppId } }).catch(() => {});
        await db.company.deleteMany({ where: { key: `co-${oppId.toLowerCase()}` } }).catch(() => {});
        await db.opportunity.deleteMany({ where: { opportunityId: oppId } }).catch(() => {});
      }
    },
  },
];

const BUILD_TASK: BenchTask = {
  id: "build-mission", capability: "BUILD", weight: 2,
  async run() {
    // Real orchestrator mission (heavy). Score = fraction of pipeline tasks DONE.
    const r = await dispatchGoal("build a hello world CLI tool", { board: false });
    const total = r.taskResults.length;
    const done = r.taskResults.filter((t) => t.status === "DONE").length;
    const score = total ? clamp((done / total) * 100) : 0;
    const tokens = (r.ceoExecution?.metrics.tokensUsed ?? 0);
    return { pass: total > 0 && done === total, score, tokens, detail: `${done}/${total} tasks DONE` };
  },
};

async function nextRunId(): Promise<string> {
  const rows = await db.benchmarkRun.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { runId: true } });
  let max = 0;
  for (const r of rows) { const m = r.runId.match(/^BM-(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `BM-${(max + 1).toString().padStart(6, "0")}`;
}

/** Run a benchmark suite against the live system and persist the scored result. */
export async function runBenchmark(opts?: { suite?: "intelligence" | "full" }): Promise<BenchmarkResult> {
  const suite = opts?.suite ?? "intelligence";
  const tasks = suite === "full" ? [...TASKS, BUILD_TASK] : TASKS;
  const runId = await nextRunId();
  const mode = pickProvider() === "none" ? "HEURISTIC" : "MIXED";
  await emit({ agent: "BENCHMARK", action: "RUN_START", detail: `${runId}: ${suite} suite (${tasks.length} tasks, ${mode})`, level: "INFO", category: "SYSTEM" });

  const started = Date.now();
  const results: TaskResult[] = [];
  for (const t of tasks) {
    const t0 = Date.now();
    try {
      const r = await t.run();
      results.push({ id: t.id, capability: t.capability, pass: r.pass, score: clamp(r.score), ms: Date.now() - t0, tokens: r.tokens ?? 0, detail: r.detail });
    } catch (e) {
      results.push({ id: t.id, capability: t.capability, pass: false, score: 0, ms: Date.now() - t0, tokens: 0, detail: `ERROR: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  const durationMs = Date.now() - started;

  const weights = new Map(tasks.map((t) => [t.id, t.weight]));
  const totalWeight = [...weights.values()].reduce((a, b) => a + b, 0);
  const autonomyScore = clamp(results.reduce((s, r) => s + r.score * (weights.get(r.id) ?? 1), 0) / totalWeight);
  const passed = results.filter((r) => r.pass).length;
  const successRate = clamp((passed / results.length) * 100);
  const tokensUsed = results.reduce((s, r) => s + r.tokens, 0);
  const avgTaskMs = Math.round(durationMs / results.length);

  await db.benchmarkRun.create({ data: { runId, suite, autonomyScore, successRate, totalTasks: results.length, passed, durationMs, avgTaskMs, tokensUsed, mode, results: JSON.stringify(results) } });
  await emit({ agent: "BENCHMARK", action: "RUN_DONE", detail: `${runId}: autonomy ${autonomyScore}/100, ${passed}/${results.length} passed (${mode}, ${durationMs}ms)`, level: passed === results.length ? "SUCCESS" : "WARNING", category: "SYSTEM" });

  return { runId, suite, autonomyScore, successRate, totalTasks: results.length, passed, durationMs, avgTaskMs, tokensUsed, mode, results };
}

/** Trend across recent runs of a suite. */
export async function benchmarkTrend(suite: "intelligence" | "full" = "intelligence", limit = 20) {
  const runs = await db.benchmarkRun.findMany({ where: { suite }, orderBy: { createdAt: "desc" }, take: limit });
  return runs.map((r) => ({ runId: r.runId, autonomyScore: r.autonomyScore, successRate: r.successRate, mode: r.mode, durationMs: r.durationMs, createdAt: r.createdAt }));
}
