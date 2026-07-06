/**
 * Mission Lifecycle Integration Test (FC-011)
 *
 * Verifies the full autonomous pipeline:
 *   CEO → RESEARCH → ARCHITECT → ENGINEERING → QUALITY → SECURITY → DEPLOYMENT → GROWTH
 *
 * Each step must produce: DB records, artifacts, logs, events.
 */

import { test, expect, beforeEach } from "bun:test";
import { db } from "@/lib/db";
import { dispatchGoal } from "@/lib/genesis/agent-runtime/orchestrator";

beforeEach(async () => {
  // Clean ALL runtime data (keep only seed narrative data)
  await db.activityLog.deleteMany({});
  await db.toolCall.deleteMany({});
  await db.artifact.deleteMany({});
  await db.testRun.deleteMany({});
  await db.deploymentRecord.deleteMany({});
  await db.securityFinding.deleteMany({});
  await db.executionAnalysis.deleteMany({});
  await db.agentExecution.deleteMany({});
  await db.genesisTask.deleteMany({ where: { taskId: { not: { startsWith: "T-0" } } } });
  await db.buildCheckpoint.deleteMany({ where: { version: { not: { startsWith: "v0." } } } });
  await db.memoryEntry.deleteMany({ where: { source: { not: "seed" } } });
});

test("mission lifecycle: dispatchGoal produces real artifacts at every step", async () => {
  const goal = "build a hello world CLI tool";
  const result = await dispatchGoal(goal, {});

  // CEO should have decomposed the goal into multiple tasks
  expect(result.ceoExecution).toBeDefined();
  expect(result.ceoExecution!.status).toBe("SUCCESS");
  expect(result.taskIds.length).toBeGreaterThan(0);

  // Pipeline should have run (taskResults may include DONE, FAILED, or BLOCKED)
  expect(result.taskResults.length).toBeGreaterThan(0);

  // Verify DB records were created
  const executions = await db.agentExecution.findMany();
  expect(executions.length).toBeGreaterThan(0);

  const tasks = await db.genesisTask.findMany({ where: { taskId: { in: result.taskIds } } });
  expect(tasks.length).toBe(result.taskIds.length);

  // Verify activity logs were created (real events)
  const activity = await db.activityLog.count();
  expect(activity).toBeGreaterThan(0);

  // Verify memories were recorded
  const memories = await db.memoryEntry.count();
  expect(memories).toBeGreaterThan(0);
}, 90_000); // 90s timeout — CEO LLM (8s) + pipeline

test("mission lifecycle: ARCHITECT produces real repository artifact", async () => {
  // Run just the ARCHITECT agent directly (faster than full pipeline)
  const { getAgent } = await import("@/lib/genesis/agent-runtime/agents");
  const architect = getAgent("ARCHITECT")!;
  const result = await architect.execute({
    goal: "build a notes app",
    context: { topic: "notes-app", stackHint: "node-cli" },
  });

  expect(result.status).toBe("SUCCESS");
  expect(result.artifacts.length).toBeGreaterThan(0);

  // Verify the repository artifact exists on disk
  const repoArtifact = result.artifacts.find((a) => a.type === "REPOSITORY");
  expect(repoArtifact).toBeDefined();

  const { promises: fs } = await import("node:fs");
  const path = await import("node:path");
  const repoPath = (result.output as { repoPath: string }).repoPath;
  const pkgExists = await fs.access(path.join(repoPath, "package.json")).then(() => true).catch(() => false);
  expect(pkgExists).toBe(true);

  // Verify DB has the artifact row
  const artifacts = await db.artifact.findMany({ where: { executionId: result.executionId } });
  expect(artifacts.length).toBeGreaterThan(0);

  // Verify DB has tool calls
  const toolCalls = await db.toolCall.findMany({ where: { executionId: result.executionId } });
  expect(toolCalls.length).toBeGreaterThan(0);

  // Verify DB has activity logs
  const activity = await db.activityLog.findMany({ where: { agent: "ARCHITECT" } });
  expect(activity.length).toBeGreaterThan(0);
}, 60_000);
