/** Task Orchestrator V4 — parallel execution, dynamic generation, retries, background missions. */

import { db } from "@/lib/db";
import { getAgent } from "../agents";
import type { BaseAgent, AgentRunResult } from "../base-agent";
import { emit, events } from "../event-bus";

if (typeof process !== "undefined") {
  process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.error("[orchestrator] unhandledRejection:", msg);
    emit(events.error("ORCHESTRATOR", `unhandled rejection: ${msg.slice(0, 200)}`)).catch(() => {});
  });
}

const agentLocks = new Map<string, Promise<unknown>>();
async function withAgentLock<T>(agent: string, fn: () => Promise<T>): Promise<T> {
  const prev = agentLocks.get(agent) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  agentLocks.set(agent, prev.then(() => next));
  await prev;
  try { return await fn(); }
  finally { release(); if (agentLocks.get(agent) === next) agentLocks.delete(agent); }
}

export interface DispatchResult {
  goal: string; projectId?: string;
  ceoExecution?: AgentRunResult;
  taskIds: string[];
  taskResults: { taskId: string; agent: string; status: string; summary: string; error?: string }[];
  summary: string;
  startedAt: Date; completedAt: Date; durationMs: number;
}

export async function dispatchGoal(goal: string, opts?: { skipCeo?: boolean; taskIds?: string[]; projectId?: string }): Promise<DispatchResult> {
  const startedAt = new Date();
  await emit(events.decision("ORCHESTRATOR", `dispatchGoal: ${goal.slice(0, 120)}`));
  let taskIds: string[] = opts?.taskIds ?? [];
  let ceoExecution: AgentRunResult | undefined;
  if (!opts?.skipCeo && !taskIds.length) {
    ceoExecution = await withAgentLock("CEO", async () => { const ceo = getAgent("CEO")!; return ceo.execute({ goal, projectId: opts?.projectId }); });
    if (ceoExecution.status !== "SUCCESS") return { goal, projectId: opts?.projectId, ceoExecution, taskIds: [], taskResults: [], summary: `CEO failed: ${ceoExecution.error ?? ceoExecution.summary}`, startedAt, completedAt: new Date(), durationMs: Date.now() - startedAt.getTime() };
    taskIds = (ceoExecution.output.plan as { tasks: { taskId: string }[] }).tasks.map((t) => t.taskId);
  }
  const taskResults = await runPipeline(taskIds, opts?.projectId);
  const successCount = taskResults.filter((r) => r.status === "DONE").length;
  const failCount = taskResults.filter((r) => r.status === "FAILED").length;
  const completedAt = new Date();
  return { goal, projectId: opts?.projectId, ceoExecution, taskIds, taskResults, summary: `Pipeline: ${successCount}/${taskResults.length} done, ${failCount} failed.`, startedAt, completedAt, durationMs: completedAt.getTime() - startedAt.getTime() };
}

export async function runPipeline(taskIds: string[], projectId?: string) {
  const results: DispatchResult["taskResults"] = [];
  const done = new Set<string>();
  const failed = new Set<string>();
  const running = new Map<string, Promise<DispatchResult["taskResults"][number]>>();
  const tasks = await db.genesisTask.findMany({ where: { taskId: { in: taskIds } }, orderBy: { taskId: "asc" } });
  const taskMap = new Map(tasks.map((t) => [t.taskId, t]));
  let safety = taskIds.length * 4;
  while (done.size + failed.size < taskIds.length && safety-- > 0) {
    let progress = false;
    // Launch ready tasks in parallel
    for (const id of taskIds) {
      if (done.has(id) || failed.has(id) || running.has(id)) continue;
      const task = taskMap.get(id);
      if (!task) { failed.add(id); results.push({ taskId: id, agent: "?", status: "FAILED", summary: "not found" }); progress = true; continue; }
      const deps = parseDeps(task.dependencies);
      const unmet = deps.filter((d) => !done.has(d) && !failed.has(d));
      if (unmet.length) continue;
      const depFailed = deps.filter((d) => failed.has(d));
      if (depFailed.length) {
        await db.genesisTask.update({ where: { taskId: id }, data: { status: "BLOCKED" } });
        failed.add(id);
        results.push({ taskId: id, agent: task.ownerAgent, status: "BLOCKED", summary: `blocked by failed deps: ${depFailed.join(", ")}` });
        progress = true; continue;
      }
      running.set(id, runTaskWithRetry(id, 2, projectId).then((r) => { if (r.status === "DONE") done.add(id); else failed.add(id); running.delete(id); return r; }));
      progress = true;
    }
    if (running.size > 0) await Promise.race(running.values());
    if (!progress && running.size === 0) {
      for (const id of taskIds) if (!done.has(id) && !failed.has(id)) { failed.add(id); results.push({ taskId: id, agent: taskMap.get(id)?.ownerAgent ?? "?", status: "BLOCKED", summary: "deadlock" }); }
      break;
    }
  }
  await Promise.all(running.values());
  return results;
}

export async function runTask(taskId: string, projectId?: string) { return runTaskWithRetry(taskId, 0, projectId); }

async function runTaskWithRetry(taskId: string, maxRetries: number, projectId?: string) {
  const task = await db.genesisTask.findUnique({ where: { taskId } });
  if (!task) return { taskId, agent: "?", status: "FAILED", summary: "not found" };
  const agent = getAgent(task.ownerAgent);
  if (!agent) { await db.genesisTask.update({ where: { taskId }, data: { status: "FAILED" } }); return { taskId, agent: task.ownerAgent, status: "FAILED", summary: `agent not registered` }; }
  await db.genesisTask.update({ where: { taskId }, data: { status: "IN_PROGRESS", progress: 10, startedAt: new Date() } });
  await emit({ agent: task.ownerAgent, action: "TASK_START", detail: `${taskId}: ${task.title}`, level: "INFO", category: "TASK", taskId });
  let lastError: string | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await withAgentLock(task.ownerAgent, async () => (agent as BaseAgent).execute({ goal: `${task.title}: ${task.description}`, taskId, projectId, context: { topic: task.title } }));
    if (result.status === "SUCCESS") {
      await db.genesisTask.update({ where: { taskId }, data: { status: "DONE", progress: 100, completedAt: new Date() } });
      await emit({ agent: task.ownerAgent, action: "TASK_DONE", detail: `${taskId} DONE: ${result.summary.slice(0, 120)}`, level: "SUCCESS", category: "TASK", taskId });
      return { taskId, agent: task.ownerAgent, status: "DONE", summary: result.summary };
    }
    lastError = result.error;
    if (attempt < maxRetries) { await db.genesisTask.update({ where: { taskId }, data: { status: "REVIEW", progress: 50 } }); await emit({ agent: task.ownerAgent, action: "RETRY", detail: `${taskId} retry ${attempt + 1}/${maxRetries}`, level: "WARNING", category: "TASK", taskId }); }
  }
  await db.genesisTask.update({ where: { taskId }, data: { status: "FAILED" } });
  await emit(events.error(task.ownerAgent, `${taskId} FAILED: ${lastError ?? "unknown"}`));
  return { taskId, agent: task.ownerAgent, status: "FAILED", summary: lastError ?? "failed", error: lastError };
}

function parseDeps(s: string): string[] { try { const v = JSON.parse(s); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } }

export interface MissionHandle { missionId: string; goal: string; projectId?: string; status: string; startedAt: Date; result?: DispatchResult; error?: string; }
const missions = new Map<string, MissionHandle>();

export function startMission(goal: string, projectId?: string): MissionHandle {
  const missionId = `M-${Date.now().toString(36)}`;
  const handle: MissionHandle = { missionId, goal, projectId, status: "RUNNING", startedAt: new Date() };
  missions.set(missionId, handle);
  // Run in background
  dispatchGoal(goal, { projectId })
    .then((result) => { handle.status = "COMPLETE"; handle.result = result; })
    .catch((e) => { handle.status = "FAILED"; handle.error = e instanceof Error ? e.message : String(e); });
  return handle;
}
export function getMission(missionId: string) { return missions.get(missionId); }
export function listMissions() { return [...missions.values()]; }

export async function getStatus() {
  const tasks = await db.genesisTask.findMany();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  return {
    queued: tasks.filter((t) => t.status === "PENDING").length,
    inProgress: tasks.filter((t) => t.status === "IN_PROGRESS").length,
    doneToday: tasks.filter((t) => t.completedAt && t.completedAt >= todayStart && t.status === "DONE").length,
    failedToday: tasks.filter((t) => t.completedAt && t.completedAt >= todayStart && t.status === "FAILED").length,
    agentLocks: [...agentLocks.keys()],
    activeMissions: [...missions.values()].filter((m) => m.status === "RUNNING").length,
  };
}
