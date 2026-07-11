/** Evolution loop CLOSED at runtime (V8 G7 ↔ G11 bridge): the ACTIVE PromptVersion
 *  rides along on every real ctx.llm call as labeled guidance, and real execution
 *  outcomes are recorded onto that version — which is exactly what SKILL plugin
 *  stats read. Before this, evolved prompts were written but never used. Network-free. */

import { test, expect, beforeEach, afterAll } from "bun:test";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { db } from "@/lib/db";
import { BaseAgent, type AgentRunInput, type AgentRunContext } from "@/lib/genesis/agent-runtime/base-agent";
import { setPrompt } from "@/lib/genesis/agent-runtime/improvement/prompts";
import { seedRegistry } from "@/lib/genesis/agent-runtime/model-registry";

const AGENT = "EVORUNTIME_PROBE";

const KEYS = ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "OLLAMA_HOST", "ZAI_API_KEY", "PREMIUM_MODE"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];

class ProbeAgent extends BaseAgent {
  readonly name = AGENT;
  readonly department = "TEST";
  captured: string[] = [];
  failRun = false;
  constructor(seam: "ok" | "throw" = "ok") {
    super();
    this.llmInvokeSeam = seam === "ok"
      ? async (_p: unknown, opts: { system?: string }) => { this.captured.push(opts.system ?? ""); return { text: "seam reply", promptTokens: 5, completionTokens: 5 }; }
      : async () => { throw new Error("HTTP_400 seam refuses every hop"); }; // non-transient: no retry backoff
  }
  protected async run(_input: AgentRunInput, ctx: AgentRunContext) {
    const r = await ctx.llm("task-specific system", "user question");
    if (this.failRun) throw new Error("probe deliberate failure");
    if (!r.ok) throw new Error(`llm failed: ${r.error}`);
    return { summary: "probe ok", artifacts: [], output: { text: r.text } };
  }
}

async function wipe() {
  await db.promptVersion.deleteMany({ where: { agent: AGENT } });
  await db.agentExecution.deleteMany({ where: { agent: AGENT } });
  await db.llmUsage.deleteMany({ where: { agent: AGENT } });
  await db.activityLog.deleteMany({ where: { agent: AGENT } });
  await db.memoryEntry.deleteMany({ where: { source: { startsWith: AGENT } } });
}

beforeEach(async () => {
  await wipe();
  await seedRegistry();
  for (const k of KEYS) delete process.env[k];
  process.env.OPENROUTER_API_KEY = "sk-test"; // a chain must resolve; the seam intercepts every hop
});
afterAll(async () => {
  await wipe();
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  await fs.rm(path.resolve(process.cwd(), ".genesis-workspace", AGENT.toLowerCase()), { recursive: true, force: true }).catch(() => {});
});

test("active evolved prompt is injected into real ctx.llm calls, labeled and appended", async () => {
  await setPrompt(AGENT, "Always verify tool exit codes before declaring success.", "evolution guard");
  const probe = new ProbeAgent();
  const r = await probe.execute({ goal: "probe goal" });
  expect(r.status).toBe("SUCCESS");
  expect(probe.captured.length).toBe(1);
  expect(probe.captured[0].startsWith("task-specific system")).toBe(true); // per-call prompt stays authoritative
  expect(probe.captured[0]).toContain("[EVOLVED PROMPT v1");
  expect(probe.captured[0]).toContain("Always verify tool exit codes");
});

test("real SUCCESS outcome is recorded onto the ACTIVE version (skill stats become real)", async () => {
  const v = await setPrompt(AGENT, "guidance");
  await new ProbeAgent().execute({ goal: "probe goal" });
  const row = await db.promptVersion.findUnique({ where: { id: v.id } });
  expect(row!.successCount).toBe(1);
  expect(row!.failCount).toBe(0);
});

test("real FAILED outcome is recorded when the model consumed the prompt", async () => {
  const v = await setPrompt(AGENT, "guidance");
  const probe = new ProbeAgent();
  probe.failRun = true; // llm succeeds, the run then fails — the prompt steered a failed run
  const r = await probe.execute({ goal: "probe goal" });
  expect(r.status).toBe("FAILED");
  const row = await db.promptVersion.findUnique({ where: { id: v.id } });
  expect(row!.successCount).toBe(0);
  expect(row!.failCount).toBe(1);
});

test("transport-level failure records NOTHING against the prompt (model never saw it)", async () => {
  const v = await setPrompt(AGENT, "guidance");
  const probe = new ProbeAgent("throw"); // every hop dies before a model consumes the prompt
  const r = await probe.execute({ goal: "probe goal" });
  expect(r.status).toBe("FAILED"); // honest execution failure…
  const row = await db.promptVersion.findUnique({ where: { id: v.id } });
  expect(row!.successCount).toBe(0); // …but no verdict on a prompt no model ever read
  expect(row!.failCount).toBe(0);
});

test("no lineage → system untouched, no outcome, and NO auto-seeded skill lineage", async () => {
  const probe = new ProbeAgent();
  const r = await probe.execute({ goal: "probe goal" });
  expect(r.status).toBe("SUCCESS");
  expect(probe.captured[0]).toBe("task-specific system"); // exactly as the agent wrote it
  expect(await db.promptVersion.count({ where: { agent: AGENT } })).toBe(0); // running ≠ creating a skill
});

test("outcomes accumulate on the version that was active at run time (lineage integrity)", async () => {
  const v1 = await setPrompt(AGENT, "v1 guidance");
  await new ProbeAgent().execute({ goal: "run under v1" });
  const v2 = await setPrompt(AGENT, "v2 guidance"); // evolution publishes an improvement
  await new ProbeAgent().execute({ goal: "run under v2" });
  expect((await db.promptVersion.findUnique({ where: { id: v1.id } }))!.successCount).toBe(1);
  expect((await db.promptVersion.findUnique({ where: { id: v2.id } }))!.successCount).toBe(1);
});
