/** V8 G11 — Plugin marketplace tests: real-artifact validation, real-usage perf, trust, install, versioning, benchmark. */

import { test, expect, beforeEach, afterAll } from "bun:test";
import { db } from "@/lib/db";
import { publishPlugin, syncFromRegistry, refreshStats, computeTrust, installPlugin, uninstallPlugin, deprecatePlugin, publishVersion, benchmarkPlugin, artifactExists, KNOWN_WORKFLOWS } from "@/lib/genesis/agent-runtime/plugins";

async function wipe() {
  const plugins = await db.plugin.findMany({ where: { refKey: { startsWith: "PLGTEST" } } });
  for (const p of plugins) await db.plugin.delete({ where: { pluginId: p.pluginId } }); // versions cascade
  await db.plugin.deleteMany({ where: { refKey: "VENTURE" } });
  await db.agentExecution.deleteMany({ where: { executionId: { startsWith: "PLGX-" } } });
  await db.agentTemplate.deleteMany({ where: { key: { startsWith: "PLGTEST" } } });
  await db.promptVersion.deleteMany({ where: { agent: { startsWith: "PLGTEST" } } });
}
beforeEach(wipe);
afterAll(wipe); // the db file is committed — leave no test residue behind

test("artifactExists / publish: refuses a plugin for a non-existent module (no fake plugins)", async () => {
  expect(await artifactExists("AGENT", "VENTURE")).toBe(true); // real registered agent
  expect(await artifactExists("AGENT", "PLGTEST_NOPE")).toBe(false);
  const bad = await publishPlugin({ kind: "AGENT", refKey: "PLGTEST_NOPE" });
  expect("error" in bad).toBe(true);
  const good = await publishPlugin({ kind: "AGENT", refKey: "VENTURE", source: "BUILTIN" });
  expect("pluginId" in good).toBe(true);
});

test("publish is idempotent per (kind, refKey)", async () => {
  const a = await publishPlugin({ kind: "AGENT", refKey: "VENTURE" });
  const b = await publishPlugin({ kind: "AGENT", refKey: "VENTURE" });
  expect((a as { pluginId: string }).pluginId).toBe((b as { pluginId: string }).pluginId);
});

test("publish can wrap an evolution-created AgentTemplate (real artifact)", async () => {
  await db.agentTemplate.create({ data: { key: "PLGTEST_SPECIALIST", name: "PLGTEST spec", description: "d", systemPrompt: "p", toolAllowlist: "[]", isBuiltin: false } });
  const r = await publishPlugin({ kind: "AGENT", refKey: "PLGTEST_SPECIALIST", source: "EVOLUTION" });
  expect("pluginId" in r).toBe(true);
});

test("refreshStats reads REAL executions → performance; trust reflects source + usage volume", async () => {
  // Seed 10 real executions for a test agent template plugin: 8 success, 2 fail.
  await db.agentTemplate.create({ data: { key: "PLGTEST_AGENT", name: "a", description: "d", systemPrompt: "p", toolAllowlist: "[]", isBuiltin: false } });
  const pub = await publishPlugin({ kind: "AGENT", refKey: "PLGTEST_AGENT", source: "EVOLUTION" }) as { pluginId: string };
  for (let i = 0; i < 10; i++) await db.agentExecution.create({ data: { executionId: `PLGX-${i}`, agent: "PLGTEST_AGENT", goal: "t", status: i < 8 ? "SUCCESS" : "FAILED", startedAt: new Date(), durationMs: 10 } });
  await refreshStats(pub.pluginId);
  const p = await db.plugin.findUnique({ where: { pluginId: pub.pluginId } });
  expect(p!.invocations).toBe(10);
  expect(p!.successes).toBe(8);
  expect(p!.performanceScore).toBe(80);
  expect(p!.trustScore).toBeGreaterThan(0);
});

test("trust: unproven (0 usage) scores far below a proven high-success plugin", () => {
  const unproven = computeTrust("EVOLUTION", 0, 0, 0);
  const proven = computeTrust("EVOLUTION", 90, 40, 0); // 40 real runs at 90%
  expect(proven).toBeGreaterThan(unproven);
  // volume damps performance: same performance, more usage ⇒ more trust
  expect(computeTrust("USER", 90, 40, 0)).toBeGreaterThan(computeTrust("USER", 90, 2, 0));
});

test("install increments count and marks INSTALLED", async () => {
  const pub = await publishPlugin({ kind: "AGENT", refKey: "VENTURE" }) as { pluginId: string };
  const r = await installPlugin(pub.pluginId);
  expect(r.ok).toBe(true);
  expect(r.installCount).toBe(1);
  const p = await db.plugin.findUnique({ where: { pluginId: pub.pluginId } });
  expect(p!.status).toBe("INSTALLED");
});

test("versioning: publishVersion bumps version and activates only the latest", async () => {
  const pub = await publishPlugin({ kind: "AGENT", refKey: "VENTURE" }) as { pluginId: string };
  const v2 = await publishVersion(pub.pluginId, { changelog: "tuned" });
  expect((v2 as { version: number }).version).toBe(2);
  const active = await db.pluginVersion.findMany({ where: { pluginId: pub.pluginId, active: true } });
  expect(active.length).toBe(1);
  expect(active[0].version).toBe(2);
});

test("benchmark: records a measured score from real metrics + updates trust", async () => {
  await db.agentTemplate.create({ data: { key: "PLGTEST_BENCH", name: "b", description: "d", systemPrompt: "p", toolAllowlist: "[]", isBuiltin: false } });
  const pub = await publishPlugin({ kind: "AGENT", refKey: "PLGTEST_BENCH", source: "EVOLUTION" }) as { pluginId: string };
  for (let i = 0; i < 6; i++) await db.agentExecution.create({ data: { executionId: `PLGX-b${i}`, agent: "PLGTEST_BENCH", goal: "t", status: "SUCCESS", startedAt: new Date(), durationMs: 10 } });
  const r = await benchmarkPlugin(pub.pluginId);
  expect((r as { benchmarkScore: number }).benchmarkScore).toBe(100); // 6/6 success
  const p = await db.plugin.findUnique({ where: { pluginId: pub.pluginId } });
  expect(p!.benchmarkedAt).not.toBeNull();
});

test("sync populates the ecosystem from real registered agents + tools", async () => {
  const before = await db.plugin.count();
  await syncFromRegistry();
  const after = await db.plugin.count();
  expect(after).toBeGreaterThanOrEqual(before); // idempotent; publishes any not-yet-listed real artifacts
  // every registered agent should now have a plugin
  const venture = await db.plugin.findUnique({ where: { kind_refKey: { kind: "AGENT", refKey: "VENTURE" } } });
  expect(venture).not.toBeNull();
  const browser = await db.plugin.findUnique({ where: { kind_refKey: { kind: "TOOL", refKey: "browser" } } });
  expect(browser).not.toBeNull();
});

// ---- G11 extension: SKILL kind, workflow stats, lifecycle ----

test("SKILL: only agents with real PromptVersion lineage qualify; stats come from ACTIVE version outcomes", async () => {
  expect(await artifactExists("SKILL", "PLGTEST_SKILLAG")).toBe(false); // no prompt versions yet
  const bad = await publishPlugin({ kind: "SKILL", refKey: "PLGTEST_SKILLAG" });
  expect("error" in bad).toBe(true);
  // real lineage: two versions, the active one has real recorded outcomes
  await db.promptVersion.create({ data: { agent: "PLGTEST_SKILLAG", version: 1, systemPrompt: "v1", active: false, successCount: 3, failCount: 3 } });
  await db.promptVersion.create({ data: { agent: "PLGTEST_SKILLAG", version: 2, systemPrompt: "v2", active: true, successCount: 9, failCount: 1 } });
  expect(await artifactExists("SKILL", "PLGTEST_SKILLAG")).toBe(true);
  const pub = await publishPlugin({ kind: "SKILL", refKey: "PLGTEST_SKILLAG", source: "EVOLUTION" }) as { pluginId: string };
  await refreshStats(pub.pluginId);
  const p = await db.plugin.findUnique({ where: { pluginId: pub.pluginId } });
  expect(p!.invocations).toBe(10); // ACTIVE version only: 9 + 1 (v1's outcomes are history, not current skill perf)
  expect(p!.successes).toBe(9);
  expect(p!.performanceScore).toBe(90);
});

test("WORKFLOW: performance mirrors the workflow's own reality table (createCompany → VentureRun)", async () => {
  const pub = await publishPlugin({ kind: "WORKFLOW", refKey: "createCompany", source: "BUILTIN" }) as { pluginId: string };
  await refreshStats(pub.pluginId);
  const p = await db.plugin.findUnique({ where: { pluginId: pub.pluginId } });
  const runs = await db.ventureRun.findMany({ select: { status: true } });
  expect(p!.invocations).toBe(runs.length); // exactly the real run count — nothing fabricated
  expect(p!.successes).toBe(runs.filter((r) => r.status !== "FAILED").length);
  // unknown workflows are refused outright
  const bad = await publishPlugin({ kind: "WORKFLOW", refKey: "PLGTEST_fakeflow" });
  expect("error" in bad).toBe(true);
});

test("uninstall: INSTALLED → LISTED; refuses when not installed", async () => {
  const pub = await publishPlugin({ kind: "AGENT", refKey: "VENTURE" }) as { pluginId: string };
  expect((await uninstallPlugin(pub.pluginId)).ok).toBe(false); // never installed
  await installPlugin(pub.pluginId);
  const r = await uninstallPlugin(pub.pluginId);
  expect(r.ok).toBe(true);
  const p = await db.plugin.findUnique({ where: { pluginId: pub.pluginId } });
  expect(p!.status).toBe("LISTED");
  expect(p!.installCount).toBe(1); // history preserved — the install really happened
});

test("deprecate: blocks future installs, keeps history, idempotent", async () => {
  await db.agentTemplate.create({ data: { key: "PLGTEST_DEPR", name: "d", description: "d", systemPrompt: "p", toolAllowlist: "[]", isBuiltin: false } });
  const pub = await publishPlugin({ kind: "AGENT", refKey: "PLGTEST_DEPR", source: "EVOLUTION" }) as { pluginId: string };
  expect((await deprecatePlugin(pub.pluginId, "superseded")).ok).toBe(true);
  expect((await deprecatePlugin(pub.pluginId)).ok).toBe(true); // idempotent
  const p = await db.plugin.findUnique({ where: { pluginId: pub.pluginId } });
  expect(p!.status).toBe("DEPRECATED");
  const inst = await installPlugin(pub.pluginId);
  expect(inst.ok).toBe(false);
  expect(inst.error).toContain("deprecated");
});

test("sync also lists workflows and skill lineages", async () => {
  await db.promptVersion.create({ data: { agent: "PLGTEST_SYNCSKILL", version: 1, systemPrompt: "p", active: true, successCount: 0, failCount: 0 } });
  await syncFromRegistry();
  for (const wf of KNOWN_WORKFLOWS) {
    const p = await db.plugin.findUnique({ where: { kind_refKey: { kind: "WORKFLOW", refKey: wf } } });
    expect(p).not.toBeNull();
  }
  const skill = await db.plugin.findUnique({ where: { kind_refKey: { kind: "SKILL", refKey: "PLGTEST_SYNCSKILL" } } });
  expect(skill).not.toBeNull();
  expect(skill!.source).toBe("EVOLUTION");
});
