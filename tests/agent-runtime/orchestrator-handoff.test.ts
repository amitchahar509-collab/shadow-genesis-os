/**
 * Cycle-2 regression tests:
 * - dependencyContext: dependent tasks receive predecessor outputs (repoPath, stack → stackHint)
 * - reapOrphanedExecutions: crashed RUNNING rows are marked FAILED
 * - nextTaskNumber: numeric (not lexicographic) allocation past digit rollovers
 */

import { test, expect } from "bun:test";
import { db } from "@/lib/db";
import { dependencyContext, reapOrphanedExecutions } from "@/lib/genesis/agent-runtime/orchestrator";
import { nextTaskNumber } from "@/lib/genesis/agent-runtime/agents/core";

test("dependencyContext merges dependency outputs and maps stack → stackHint", async () => {
  const taskId = "T-TESTDEP1";
  const execId = "EX-TESTDEP1";
  await db.agentExecution.deleteMany({ where: { executionId: execId } });
  await db.agentExecution.create({ data: { executionId: execId, agent: "ENGINEERING", taskId, goal: "test", status: "SUCCESS", startedAt: new Date(), result: JSON.stringify({ summary: "ok", output: { repoPath: "/tmp/repo-x", stack: "node-cli", topic: "widget" } }) } });

  const ctx = await dependencyContext(JSON.stringify([taskId]));
  expect(ctx.repoPath).toBe("/tmp/repo-x");
  expect(ctx.stack).toBe("node-cli");
  expect(ctx.stackHint).toBe("node-cli");
  expect(ctx.topic).toBe("widget");

  await db.agentExecution.deleteMany({ where: { executionId: execId } });
});

test("dependencyContext returns empty object for no deps", async () => {
  expect(await dependencyContext("[]")).toEqual({});
  expect(await dependencyContext("not-json")).toEqual({});
});

test("reapOrphanedExecutions marks stale RUNNING rows FAILED", async () => {
  const execId = "EX-TESTORPHAN";
  await db.agentExecution.deleteMany({ where: { executionId: execId } });
  await db.agentExecution.create({ data: { executionId: execId, agent: "CEO", goal: "test orphan", status: "RUNNING", startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } });

  const reaped = await reapOrphanedExecutions(60 * 60 * 1000);
  expect(reaped).toBeGreaterThanOrEqual(1);
  const row = await db.agentExecution.findUnique({ where: { executionId: execId } });
  expect(row?.status).toBe("FAILED");
  expect(row?.error).toContain("orphaned");

  await db.agentExecution.deleteMany({ where: { executionId: execId } });
});

test("reapOrphanedExecutions leaves fresh RUNNING rows alone", async () => {
  const execId = "EX-TESTFRESH";
  await db.agentExecution.deleteMany({ where: { executionId: execId } });
  await db.agentExecution.create({ data: { executionId: execId, agent: "CEO", goal: "test fresh", status: "RUNNING", startedAt: new Date() } });

  await reapOrphanedExecutions(60 * 60 * 1000);
  const row = await db.agentExecution.findUnique({ where: { executionId: execId } });
  expect(row?.status).toBe("RUNNING");

  await db.agentExecution.deleteMany({ where: { executionId: execId } });
});

test("pickProvider prefers anthropic, then zai, else none", async () => {
  const { pickProvider } = await import("@/lib/genesis/agent-runtime/types");
  const savedA = process.env.ANTHROPIC_API_KEY, savedZ = process.env.ZAI_API_KEY;
  try {
    process.env.ANTHROPIC_API_KEY = "test-key"; process.env.ZAI_API_KEY = "test-key";
    expect(pickProvider()).toBe("anthropic");
    delete process.env.ANTHROPIC_API_KEY;
    expect(pickProvider()).toBe("zai");
    delete process.env.ZAI_API_KEY;
    expect(pickProvider()).toBe("none");
  } finally {
    if (savedA !== undefined) process.env.ANTHROPIC_API_KEY = savedA;
    if (savedZ !== undefined) process.env.ZAI_API_KEY = savedZ;
  }
});

test("nextTaskNumber allocates numerically past lexicographic rollover", async () => {
  await db.genesisTask.deleteMany({ where: { taskId: { in: ["T-999", "T-1000"] } } });
  await db.genesisTask.create({ data: { taskId: "T-999", title: "t", description: "t", ownerAgent: "CEO", department: "ceo", dependencies: "[]", expectedArtifact: "none", validation: "none" } });
  await db.genesisTask.create({ data: { taskId: "T-1000", title: "t", description: "t", ownerAgent: "CEO", department: "ceo", dependencies: "[]", expectedArtifact: "none", validation: "none" } });

  // lexicographic max is T-999; numeric max is T-1000 — next must be 1001
  expect(await nextTaskNumber()).toBe(1001);

  await db.genesisTask.deleteMany({ where: { taskId: { in: ["T-999", "T-1000"] } } });
});
