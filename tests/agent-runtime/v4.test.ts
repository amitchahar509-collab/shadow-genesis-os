/** V4 Runtime tests — tools, memory, agents, orchestrator, V4 agents. */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { db } from "@/lib/db";
import { filesystemTool, terminalTool, codeTool, listTools, invokeTool, canUseTool } from "@/lib/genesis/agent-runtime/tools";
import type { ToolContext } from "@/lib/genesis/agent-runtime/tools";
import { getMemoryEngine } from "@/lib/genesis/agent-runtime/memory/engine";
import { AGENT_NAMES, getAgent, describeAgents } from "@/lib/genesis/agent-runtime/agents";
import { getMessageBus, getStateManager, getCollaborationGraph, ALL_AGENTS } from "@/lib/genesis/agent-runtime/collab";
import { startMission, getStatus } from "@/lib/genesis/agent-runtime/orchestrator";
import { createSandbox, runInSandbox, cleanupSandbox, listSandboxes, healthCheck } from "@/lib/genesis/agent-runtime/sandbox/manager";
import { computeAgentMetrics, getMetricsSummary } from "@/lib/genesis/agent-runtime/observability/metrics";
import { getActivePrompt, setPrompt, listVersions, recordOutcome, rollback } from "@/lib/genesis/agent-runtime/improvement/prompts";
import { diagnoseError } from "@/lib/genesis/agent-runtime/deployment/health-monitor";

let sandbox: string;
let ctx: ToolContext;

beforeEach(async () => {
  sandbox = path.resolve(process.cwd(), ".genesis-test", `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  await fs.mkdir(sandbox, { recursive: true });
  ctx = { executionId: "TEST", agent: "TEST", sandboxRoot: sandbox, timeoutMs: 5_000 };
});

afterEach(async () => { await fs.rm(sandbox, { recursive: true, force: true }).catch(() => {}); });

// ===== Tools =====
test("filesystem: write → read round trip", async () => {
  await filesystemTool.execute("write", { path: "h.txt", content: "hi" }, ctx);
  const r = await filesystemTool.execute("read", { path: "h.txt" }, ctx);
  expect(r.ok).toBe(true);
  expect(r.raw).toBe("hi");
});

test("filesystem: rejects path escape", async () => {
  const r = await filesystemTool.execute("write", { path: "../../etc/x", content: "bad" }, ctx);
  expect(r.ok).toBe(false);
});

test("filesystem: list + mkdir + stat + exists", async () => {
  await filesystemTool.execute("mkdir", { path: "sub" }, ctx);
  await filesystemTool.execute("write", { path: "sub/a.txt", content: "a" }, ctx);
  const list = await filesystemTool.execute("list", { path: "." }, ctx);
  expect(list.ok).toBe(true);
  const ex = await filesystemTool.execute("exists", { path: "sub/a.txt" }, ctx);
  expect((ex.result as { exists: boolean }).exists).toBe(true);
});

test("terminal: exec echoes", async () => {
  const r = await terminalTool.execute("exec", { command: "echo hello" }, ctx);
  expect(r.ok).toBe(true);
  expect(r.raw).toContain("hello");
});

test("terminal: captures non-zero exit", async () => {
  const r = await terminalTool.execute("exec", { command: "false" }, ctx);
  expect(r.ok).toBe(false);
});

test("code: eval basic arithmetic", async () => {
  const r = await codeTool.execute("eval", { code: "1 + 2 * 3" }, ctx);
  expect(r.ok).toBe(true);
  expect((r.result as { value: number }).value).toBe(7);
});

test("code: eval has NO process / require", async () => {
  const r = await codeTool.execute("eval", { code: "typeof process" }, ctx);
  expect((r.result as { value: string }).value).toBe("undefined");
  const r2 = await codeTool.execute("eval", { code: "typeof require" }, ctx);
  expect((r2.result as { value: string }).value).toBe("undefined");
});

test("tool registry: listTools returns all 7 base tools", () => {
  const tools = listTools();
  const names = tools.map((t) => t.name);
  expect(names).toContain("filesystem");
  expect(names).toContain("terminal");
  expect(names).toContain("browser");
  expect(names).toContain("code");
  expect(names).toContain("git");
  expect(names).toContain("package");
  expect(names).toContain("api");
});

test("permissions: canUseTool enforces allowlist", () => {
  expect(canUseTool("RESEARCH", "browser")).toBe(true);
  expect(canUseTool("RESEARCH", "terminal")).toBe(false); // RESEARCH has no terminal
  expect(canUseTool("ENGINEERING", "terminal")).toBe(true);
});

test("invokeTool: enforces permissions", async () => {
  const r = await invokeTool("filesystem", "write", { path: "x.txt", content: "y" }, ctx);
  expect(r.ok).toBe(true);
});

// ===== Memory =====
beforeEach(async () => { await db.memoryEntry.deleteMany({ where: { source: { startsWith: "TEST:" } } }); });

test("memory: record + recall", async () => {
  const engine = getMemoryEngine();
  const r = await engine.record({ type: "SEMANTIC", title: "Test memory", content: "test content for recall", tags: ["test"], importance: 7, source: "TEST:1" });
  expect(r.id).toBeDefined();
  const results = await engine.recall({ query: "test", tags: ["test"], limit: 5 });
  expect(results.length).toBeGreaterThan(0);
});

test("memory: similarMissions finds past executions", async () => {
  const engine = getMemoryEngine();
  await engine.record({ type: "EPISODIC", title: "build a notes app", content: "notes app execution", tags: ["execution"], importance: 7, source: "TEST:2" });
  const results = await engine.similarMissions("build a todo app", 5);
  expect(results.length).toBeGreaterThan(0);
});

// ===== Agents =====
test("agent registry: includes V4 agents", () => {
  expect(AGENT_NAMES).toContain("CEO");
  expect(AGENT_NAMES).toContain("OPPORTUNITY");
  expect(AGENT_NAMES).toContain("REVENUE");
  expect(AGENT_NAMES).toContain("INTERNET");
  expect(AGENT_NAMES.length).toBeGreaterThanOrEqual(11);
});

test("getAgent: returns instance for each registered name", () => {
  for (const name of AGENT_NAMES) {
    const a = getAgent(name);
    expect(a).toBeDefined();
    expect(a?.name).toBe(name);
  }
});

test("describeAgents: returns metadata for each agent", () => {
  const desc = describeAgents();
  expect(desc.length).toBe(AGENT_NAMES.length);
  for (const d of desc) {
    expect(d.name).toBeDefined();
    expect(d.department).toBeDefined();
    expect(d.description).toBeDefined();
  }
});

// ===== Collaboration =====
test("collaboration graph: CEO can send DIRECTIVE to all", () => {
  const g = getCollaborationGraph();
  expect(g.canSend("CEO", "RESEARCH", "DIRECTIVE")).toBe(true);
  expect(g.canSend("CEO", "ENGINEERING", "DIRECTIVE")).toBe(true);
  expect(g.canSend("RESEARCH", "CEO", "DIRECTIVE")).toBe(false); // RESEARCH cannot directive CEO
});

test("collaboration graph: SECURITY can BLOCK DEPLOYMENT", () => {
  const g = getCollaborationGraph();
  expect(g.canSend("SECURITY", "DEPLOYMENT", "BLOCK")).toBe(true);
});

test("message bus: rejects unauthorized route", async () => {
  const bus = getMessageBus();
  await expect(bus.send("RESEARCH", "CEO", "DIRECTIVE", {})).rejects.toThrow();
});

test("state manager: transitions", async () => {
  const sm = getStateManager();
  const agentName = `TEST_AGENT_${Date.now()}`;
  await sm.transition(agentName, "THINKING");
  const s = await sm.get(agentName);
  expect(s.state).toBe("THINKING");
});

test("state manager: rejects invalid transition", async () => {
  const sm = getStateManager();
  const agentName = `TEST_AGENT_2_${Date.now()}`;
  // New agent starts at IDLE (default). IDLE → DONE is illegal.
  await expect(sm.transition(agentName, "DONE")).rejects.toThrow();
});

// ===== Sandbox =====
const createdSandboxes: string[] = [];
afterEach(async () => { for (const id of createdSandboxes.splice(0)) await cleanupSandbox(id).catch(() => {}); });

test("sandbox: create + run + cleanup", async () => {
  const sb = await createSandbox({ ttlSeconds: 60 });
  createdSandboxes.push(sb.sandboxId);
  expect(sb.sandboxId).toMatch(/^SBX-\d+$/);
  expect(sb.status).toBe("ACTIVE");
  const r = await runInSandbox(sb.sandboxId, "echo 'hello sandbox'");
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("hello sandbox");
  const list = await listSandboxes();
  expect(list.some((s) => s.sandboxId === sb.sandboxId)).toBe(true);
});

test("sandbox: healthCheck returns ok=false for unreachable", async () => {
  const hc = await healthCheck("http://localhost:59876/", { timeoutMs: 1500, intervalMs: 300 });
  expect(hc.ok).toBe(false);
});

// ===== Metrics =====
beforeEach(async () => {
  await db.agentMetric.deleteMany({ where: { agent: "TEST_METRICS_AGENT" } });
  await db.agentExecution.deleteMany({ where: { executionId: { startsWith: "TESTEX-METRICS-" } } });
});

test("metrics: computeAgentMetrics returns null when no executions", async () => {
  const m = await computeAgentMetrics("NO_SUCH_AGENT_METRICS", 1);
  expect(m).toBeNull();
});

test("metrics: computeAgentMetrics with executions", async () => {
  for (let i = 0; i < 3; i++) {
    await db.agentExecution.create({ data: { executionId: `TESTEX-METRICS-${i}`, agent: "TEST_METRICS_AGENT", goal: "test", status: i === 2 ? "FAILED" : "SUCCESS", startedAt: new Date(), completedAt: new Date(), durationMs: 100 * (i + 1), toolCalls: i, artifactsCreated: 0 } });
  }
  const m = await computeAgentMetrics("TEST_METRICS_AGENT", 1);
  expect(m).not.toBeNull();
  expect(m!.totalExecutions).toBe(3);
  expect(m!.successRate).toBeCloseTo(2 / 3, 1);
});

// ===== Prompts =====
beforeEach(async () => { await db.promptVersion.deleteMany({ where: { agent: "TEST_PROMPT_AGENT" } }); });

test("prompts: setPrompt creates new version + deactivates old", async () => {
  await setPrompt("TEST_PROMPT_AGENT", "v1 content");
  await setPrompt("TEST_PROMPT_AGENT", "v2 content");
  const versions = await listVersions("TEST_PROMPT_AGENT");
  expect(versions.length).toBe(2);
  expect(versions[0].active).toBe(true);
  expect(versions[0].systemPrompt).toBe("v2 content");
});

test("prompts: rollback activates previous", async () => {
  await setPrompt("TEST_PROMPT_AGENT", "v1");
  await setPrompt("TEST_PROMPT_AGENT", "v2");
  const rolled = await rollback("TEST_PROMPT_AGENT");
  expect(rolled).not.toBeNull();
  expect(rolled!.version).toBe(1);
});

test("prompts: recordOutcome increments counts", async () => {
  const p = await setPrompt("TEST_PROMPT_AGENT", "v1");
  await recordOutcome(p.id, true);
  await recordOutcome(p.id, false);
  const versions = await listVersions("TEST_PROMPT_AGENT");
  expect(versions[0].successCount).toBe(1);
  expect(versions[0].failCount).toBe(1);
});

// ===== Health Monitor =====
test("health-monitor: diagnoseError categorizes port conflict", () => {
  const d = diagnoseError("Error: listen EADDRINUSE: address already in use 0.0.0.0:3000");
  expect(d.category).toBe("PORT_CONFLICT");
});

test("health-monitor: diagnoseError categorizes OOM", () => {
  const d = diagnoseError("FATAL ERROR: Reached heap limit - JavaScript heap out of memory");
  expect(d.category).toBe("OOM");
  expect(d.severity).toBe("CRITICAL");
});

// ===== Orchestrator =====
test("orchestrator: startMission returns handle immediately", () => {
  const handle = startMission("test mission that will not complete in this test");
  expect(handle.missionId).toMatch(/^M-/);
  expect(handle.status).toBe("RUNNING");
});

test("orchestrator: getStatus returns snapshot", async () => {
  const s = await getStatus();
  expect(s).toHaveProperty("queued");
  expect(s).toHaveProperty("inProgress");
  expect(s).toHaveProperty("activeMissions");
});

// ===== V4 — System map endpoint shape =====
test("V4: AGENT_NAMES includes all 13 V4 agents", () => {
  const required = ["CEO", "RESEARCH", "ARCHITECT", "ENGINEERING", "DESIGN", "GROWTH", "QUALITY", "DEPLOYMENT", "SECURITY", "OPPORTUNITY", "BUSINESS_VALIDATION", "REVENUE", "INTERNET"];
  for (const a of required) expect(AGENT_NAMES).toContain(a);
});

test("V4: ALL_AGENTS in collab includes V4 agents", () => {
  expect(ALL_AGENTS).toContain("OPPORTUNITY");
  expect(ALL_AGENTS).toContain("REVENUE");
  expect(ALL_AGENTS).toContain("INTERNET");
});
