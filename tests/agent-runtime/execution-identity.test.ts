/** Execution-identity integrity: executionIds are minted from a persistent
 *  monotonic sequence (GenesisState EX_SEQ), so deleting execution rows can never
 *  cause an id to be REISSUED — the defect that cross-linked unrelated runs'
 *  LlmUsage/artifact trails under one id after test wipes. */

import { test, expect, beforeEach, afterAll } from "bun:test";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { db } from "@/lib/db";
import { BaseAgent } from "@/lib/genesis/agent-runtime/base-agent";

const AGENT = "EXIDTEST_NOOP";
const num = (id: string) => parseInt(id.slice(3), 10);

class NoopAgent extends BaseAgent {
  readonly name = AGENT;
  readonly department = "test";
  protected async run() { return { summary: "noop", artifacts: [], output: {} }; }
}

async function wipe() {
  await db.agentExecution.deleteMany({ where: { agent: AGENT } });
  await db.llmUsage.deleteMany({ where: { agent: AGENT } });
  await db.activityLog.deleteMany({ where: { agent: AGENT } });
  await db.memoryEntry.deleteMany({ where: { source: { startsWith: AGENT } } });
}

beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await fs.rm(path.resolve(process.cwd(), ".genesis-workspace", AGENT.toLowerCase()), { recursive: true, force: true }).catch(() => {});
});

test("deleting the newest execution row never re-mints its id", async () => {
  const a = await new NoopAgent().execute({ goal: "first" });
  await db.agentExecution.delete({ where: { executionId: a.executionId } }); // the old max-scan would now re-mint this id
  const b = await new NoopAgent().execute({ goal: "second" });
  expect(num(b.executionId)).toBeGreaterThan(num(a.executionId));
});

test("counter seeding respects orphaned LlmUsage rows (they hold the true high-water mark)", async () => {
  // simulate a db that predates the sequence: no counter, execution rows wiped,
  // but an orphaned usage row still references a high executionId
  await db.genesisState.deleteMany({ where: { key: "EX_SEQ" } });
  const all = await db.agentExecution.findMany({ select: { executionId: true } });
  const maxExisting = Math.max(0, ...all.map((r) => num(r.executionId)).filter((n) => !isNaN(n)));
  const orphanNum = maxExisting + 100;
  await db.llmUsage.create({ data: { agent: AGENT, capability: "DEFAULT", provider: "gemini", model: "seeded-orphan", executionId: `EX-${orphanNum.toString().padStart(6, "0")}` } });
  const r = await new NoopAgent().execute({ goal: "post-orphan" });
  expect(num(r.executionId)).toBeGreaterThan(orphanNum); // never reissue an id any table still references
});

test("parallel allocations stay unique (serialization regression)", async () => {
  const runs = await Promise.all([1, 2, 3, 4, 5].map((i) => new NoopAgent().execute({ goal: `p${i}` })));
  const ids = new Set(runs.map((r) => r.executionId));
  expect(ids.size).toBe(5);
});

test("sequence survives across allocations monotonically (no gaps closed, no rewind)", async () => {
  const a = await new NoopAgent().execute({ goal: "m1" });
  const b = await new NoopAgent().execute({ goal: "m2" });
  const c = await new NoopAgent().execute({ goal: "m3" });
  expect(num(b.executionId)).toBeGreaterThan(num(a.executionId));
  expect(num(c.executionId)).toBeGreaterThan(num(b.executionId));
  const seq = await db.genesisState.findUnique({ where: { key: "EX_SEQ" } });
  expect(parseInt(seq!.value, 10)).toBeGreaterThanOrEqual(num(c.executionId)); // counter is the ratchet
});
