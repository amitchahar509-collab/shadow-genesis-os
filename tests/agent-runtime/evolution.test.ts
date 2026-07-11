/** V8 G7 — Agent Evolution tests: data-driven decisions, real prompt/template side effects, honesty. */

import { test, expect, beforeEach, afterAll } from "bun:test";
import { db } from "@/lib/db";
import { evolveAgent, evolveAll, evaluateAgent } from "@/lib/genesis/agent-runtime/evolution";
import { setPrompt, getActivePrompt, listVersions } from "@/lib/genesis/agent-runtime/improvement/prompts";

async function seedExecutions(agent: string, statuses: ("SUCCESS" | "FAILED")[]) {
  let i = 0;
  for (const status of statuses) {
    await db.agentExecution.create({ data: { executionId: `EVOX-${agent}-${i++}`, agent, goal: "t", status, startedAt: new Date(), completedAt: new Date(), durationMs: 100, toolCalls: 1, artifactsCreated: status === "SUCCESS" ? 1 : 0 } });
  }
}
async function seedFailure(agent: string, category: string, occurrences: number) {
  await db.failureAnalysis.create({ data: { executionId: `EVOF-${agent}`, agent, category, rootCause: "seeded", recommendation: `handle ${category} explicitly`, recurring: occurrences >= 2, occurrences } });
}
async function wipe(agent: string) {
  await db.agentExecution.deleteMany({ where: { executionId: { startsWith: `EVOX-${agent}-` } } });
  await db.failureAnalysis.deleteMany({ where: { executionId: `EVOF-${agent}` } });
  await db.evolutionAction.deleteMany({ where: { agent } });
  await db.promptVersion.deleteMany({ where: { agent } });
  await db.agentTemplate.deleteMany({ where: { key: { startsWith: agent } } });
  await db.agentMetric.deleteMany({ where: { agent } });
  await db.plugin.deleteMany({ where: { refKey: { startsWith: agent } } }); // auto-published specialists
}

const AGENTS = ["EVOTESTNONE", "EVOTESTHEALTHY", "EVOTESTRETIRE", "EVOTESTIMPROVE", "EVOTESTSPEC"];
beforeEach(async () => { for (const a of AGENTS) await wipe(a); });
afterAll(async () => { for (const a of AGENTS) await wipe(a); }); // committed db — no residue

test("insufficient data → NO_ACTION, nothing applied", async () => {
  await seedExecutions("EVOTESTNONE", ["FAILED"]); // 1 run < MIN_SAMPLES
  const r = await evolveAgent("EVOTESTNONE");
  expect(r.kind).toBe("NO_ACTION");
  expect(r.applied).toBe(false);
  expect(r.reason).toContain("insufficient data");
});

test("healthy agent → NO_ACTION", async () => {
  await seedExecutions("EVOTESTHEALTHY", ["SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS"]);
  const r = await evolveAgent("EVOTESTHEALTHY");
  expect(r.kind).toBe("NO_ACTION");
  expect(r.reason).toContain("healthy");
});

test("catastrophic success rate → RETIRE_WORKFLOW rolls the active prompt back", async () => {
  await setPrompt("EVOTESTRETIRE", "v1 prompt");
  await setPrompt("EVOTESTRETIRE", "v2 prompt (bad)"); // v2 active
  await seedExecutions("EVOTESTRETIRE", ["FAILED", "FAILED", "FAILED", "FAILED"]);
  const r = await evolveAgent("EVOTESTRETIRE");
  expect(r.kind).toBe("RETIRE_WORKFLOW");
  expect(r.applied).toBe(true);
  const active = await getActivePrompt("EVOTESTRETIRE");
  expect(active!.version).toBe(1); // rolled back from v2 → v1
});

test("middling + recurring failure → IMPROVE_PROMPT creates a new prompt version", async () => {
  await setPrompt("EVOTESTIMPROVE", "base prompt");
  await seedExecutions("EVOTESTIMPROVE", ["SUCCESS", "SUCCESS", "FAILED", "FAILED"]); // 0.5
  await seedFailure("EVOTESTIMPROVE", "TOOL_ERROR", 2); // recurring but < specialist threshold
  const before = (await listVersions("EVOTESTIMPROVE")).length;
  const r = await evolveAgent("EVOTESTIMPROVE");
  expect(r.kind).toBe("IMPROVE_PROMPT");
  expect(r.applied).toBe(true);
  const after = await listVersions("EVOTESTIMPROVE");
  expect(after.length).toBe(before + 1);
  expect(after[0].systemPrompt).toContain("TOOL_ERROR"); // corrective guard added
  expect(after[0].active).toBe(true);
});

test("persistent recurring failure → CREATE_SPECIALIST proposes a template", async () => {
  await seedExecutions("EVOTESTSPEC", ["SUCCESS", "SUCCESS", "FAILED", "FAILED"]); // 0.5, not catastrophic
  await seedFailure("EVOTESTSPEC", "TIMEOUT", 5); // >= SPECIALIST_OCC
  const r = await evolveAgent("EVOTESTSPEC");
  expect(r.kind).toBe("CREATE_SPECIALIST");
  const tmpl = await db.agentTemplate.findUnique({ where: { key: "EVOTESTSPEC_TIMEOUT_SPECIALIST" } });
  expect(tmpl).not.toBeNull();
  expect(tmpl!.isBuiltin).toBe(false); // a proposed spec, not a live builtin agent
  expect(r.reason).toContain("not a live agent");
  // G11: the specialist is auto-listed on the marketplace as an EVOLUTION plugin
  const listed = await db.plugin.findUnique({ where: { kind_refKey: { kind: "AGENT", refKey: "EVOTESTSPEC_TIMEOUT_SPECIALIST" } } });
  expect(listed).not.toBeNull();
  expect(listed!.source).toBe("EVOLUTION");
  expect(r.detail).toContain(listed!.pluginId);
});

test("dry-run (apply:false) records the decision but changes nothing", async () => {
  await setPrompt("EVOTESTIMPROVE", "base");
  await seedExecutions("EVOTESTIMPROVE", ["SUCCESS", "FAILED", "FAILED", "FAILED"]); // 0.25 → would retire
  await setPrompt("EVOTESTIMPROVE", "base2");
  const versionsBefore = (await listVersions("EVOTESTIMPROVE")).length;
  const activeBefore = (await getActivePrompt("EVOTESTIMPROVE"))!.version;
  const r = await evolveAgent("EVOTESTIMPROVE", { apply: false });
  expect(r.applied).toBe(false);
  const action = await db.evolutionAction.findUnique({ where: { actionId: r.actionId } });
  expect(action).not.toBeNull(); // decision is recorded
  expect((await getActivePrompt("EVOTESTIMPROVE"))!.version).toBe(activeBefore); // unchanged
  expect((await listVersions("EVOTESTIMPROVE")).length).toBe(versionsBefore);
});

test("evolveAll sweeps agents with recent activity and records an action each", async () => {
  await seedExecutions("EVOTESTHEALTHY", ["SUCCESS", "SUCCESS", "SUCCESS"]);
  const results = await evolveAll({ apply: false });
  const mine = results.find((r) => r.agent === "EVOTESTHEALTHY");
  expect(mine).toBeDefined();
  expect(mine!.metrics).not.toBeNull(); // every action carries its metric snapshot
});

test("evaluateAgent is read-only and returns metrics + recurring patterns", async () => {
  await seedExecutions("EVOTESTSPEC", ["SUCCESS", "FAILED", "FAILED"]);
  await seedFailure("EVOTESTSPEC", "CODE_ERROR", 3);
  const e = await evaluateAgent("EVOTESTSPEC");
  expect(e.metrics!.totalExecutions).toBe(3);
  expect(e.recurring[0].category).toBe("CODE_ERROR");
  const actions = await db.evolutionAction.count({ where: { agent: "EVOTESTSPEC" } });
  expect(actions).toBe(0); // evaluate must not create actions
});
