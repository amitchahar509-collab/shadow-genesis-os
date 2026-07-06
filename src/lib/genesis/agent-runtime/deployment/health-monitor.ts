/** Deployment Health Monitor (V3 Phase 7). */

import { db } from "@/lib/db";
import { emit, events } from "../event-bus";

export interface MonitorHandle {
  recordId: string; url: string; startedAt: Date; stoppedAt: Date | null;
  consecutiveFailures: number; consecutiveSuccesses: number;
  lastStatus: number | null; lastCheckedAt: Date | null;
  unhealthySince: Date | null; rolledBack: boolean;
  interval: NodeJS.Timeout | null;
}

const monitors = new Map<string, MonitorHandle>();

export function startMonitoring(recordId: string, url: string, opts?: { intervalMs?: number; maxDurationMs?: number; failureThreshold?: number; rollbackAfterMs?: number; }): MonitorHandle {
  stopMonitoring(recordId);
  const intervalMs = opts?.intervalMs ?? 10_000;
  const maxDurationMs = opts?.maxDurationMs ?? 5 * 60 * 1000;
  const failureThreshold = opts?.failureThreshold ?? 3;
  const rollbackAfterMs = opts?.rollbackAfterMs ?? 2 * 60 * 1000;
  const handle: MonitorHandle = { recordId, url, startedAt: new Date(), stoppedAt: null, consecutiveFailures: 0, consecutiveSuccesses: 0, lastStatus: null, lastCheckedAt: null, unhealthySince: null, rolledBack: false, interval: null };
  monitors.set(recordId, handle);
  const startedAtMs = Date.now();
  const tick = async () => {
    if (Date.now() - startedAtMs > maxDurationMs) { stopMonitoring(recordId); return; }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      handle.lastStatus = res.status; handle.lastCheckedAt = new Date();
      if (res.ok) { handle.consecutiveSuccesses++; handle.consecutiveFailures = 0; handle.unhealthySince = null; await db.deploymentRecord.update({ where: { id: recordId }, data: { status: "DEPLOYED", health: "HEALTHY" } }).catch(() => {}); }
      else { handle.consecutiveFailures++; handle.consecutiveSuccesses = 0; if (!handle.unhealthySince) handle.unhealthySince = new Date(); if (handle.consecutiveFailures >= failureThreshold) { await db.deploymentRecord.update({ where: { id: recordId }, data: { status: "FAILED", health: "UNHEALTHY" } }).catch(() => {}); await emit(events.tool("DEPLOYMENT", null, `${recordId} UNHEALTHY: ${handle.consecutiveFailures} failures`, "ERROR")); } }
    } catch { handle.lastStatus = null; handle.lastCheckedAt = new Date(); handle.consecutiveFailures++; handle.consecutiveSuccesses = 0; if (!handle.unhealthySince) handle.unhealthySince = new Date(); if (handle.consecutiveFailures >= failureThreshold) { await db.deploymentRecord.update({ where: { id: recordId }, data: { status: "FAILED", health: "UNHEALTHY" } }).catch(() => {}); } }
    if (handle.unhealthySince && !handle.rolledBack) { if (Date.now() - handle.unhealthySince.getTime() > rollbackAfterMs) { const r = await rollbackDeployment(recordId); if (r.ok) { handle.rolledBack = true; stopMonitoring(recordId); } } }
  };
  tick();
  handle.interval = setInterval(tick, intervalMs);
  return handle;
}

export function stopMonitoring(recordId: string): void {
  const h = monitors.get(recordId); if (h?.interval) clearInterval(h.interval); if (h) { h.interval = null; h.stoppedAt = new Date(); } monitors.delete(recordId);
}

export function getMonitorStatus(recordId: string) {
  const h = monitors.get(recordId); if (!h) return null;
  return { recordId: h.recordId, url: h.url, running: h.interval !== null, consecutiveFailures: h.consecutiveFailures, consecutiveSuccesses: h.consecutiveSuccesses, lastStatus: h.lastStatus, lastCheckedAt: h.lastCheckedAt, unhealthySince: h.unhealthySince, rolledBack: h.rolledBack };
}

export function diagnoseError(logs: string) {
  const lines = logs.split("\n");
  const lower = logs.toLowerCase();
  if (/eaddrinuse|port.*already.*in.*use/.test(lower)) return { category: "PORT_CONFLICT", severity: "HIGH", message: "Port conflict", suggestedFix: "Change PORT env or kill conflicting process", matchedLines: lines.filter((l) => /eaddrinuse|port/i.test(l)).slice(0, 3) };
  if (/cannot read property .* of undefined|env\.\w+ is undefined|missing required env/i.test(lower)) return { category: "MISSING_ENV", severity: "HIGH", message: "Missing env var", suggestedFix: "Check .env file", matchedLines: lines.filter((l) => /env|undefined|missing/i.test(l)).slice(0, 3) };
  if (/syntaxerror|unexpected token|parse error|cannot find module/i.test(lower)) return { category: "SYNTAX_ERROR", severity: "MEDIUM", message: "Syntax error or missing module", suggestedFix: "Fix the file:line mentioned", matchedLines: lines.filter((l) => /syntax|token|parse|module/i.test(l)).slice(0, 3) };
  if (/out of memory|heap out|javascript heap/i.test(lower)) return { category: "OOM", severity: "CRITICAL", message: "Out of memory", suggestedFix: "Increase --max-old-space-size", matchedLines: lines.filter((l) => /memory|heap/i.test(l)).slice(0, 3) };
  return { category: "UNKNOWN", severity: "LOW", message: "Unknown", suggestedFix: "Inspect the full log", matchedLines: lines.slice(-3) };
}

export async function rollbackDeployment(recordId: string) {
  const record = await db.deploymentRecord.findUnique({ where: { id: recordId } });
  if (!record) return { ok: false, reason: "not found" };
  const lastPassing = await db.buildCheckpoint.findFirst({ where: { status: "PASSED", createdAt: { lt: record.createdAt } }, orderBy: { createdAt: "desc" } });
  if (!lastPassing) return { ok: false, reason: "no previous passing checkpoint" };
  await db.deploymentRecord.update({ where: { id: recordId }, data: { status: "FAILED", log: (record.log ?? "") + `\n[ROLLBACK] rolled back to ${lastPassing.version} at ${new Date().toISOString()}` } });
  await emit(events.tool("DEPLOYMENT", null, `ROLLBACK ${recordId} → ${lastPassing.version}`, "WARNING"));
  try {
    const lastTaskNum = await db.genesisTask.findFirst({ orderBy: { taskId: "desc" }, select: { taskId: true } });
    const nextNum = lastTaskNum ? (parseInt(lastTaskNum.taskId.replace("T-", ""), 10) || 0) + 1 : 1;
    const taskId = `T-${nextNum.toString().padStart(3, "0")}`;
    await db.genesisTask.create({ data: { taskId, title: `Fix deployment rollback: ${record.target}`, description: `Deployment ${recordId} rolled back to ${lastPassing.version}.`, ownerAgent: "ENGINEERING", department: "engineering", priority: "HIGH", status: "PENDING", dependencies: "[]", expectedArtifact: "fixed deployment", validation: "healthy 5 min", estimatedHours: 2 } });
  } catch {}
  return { ok: true, reason: `rolled back to ${lastPassing.version}` };
}
