/** Sandbox Manager (V3 Phase 3) — lifecycle for isolated execution environments. */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { db } from "@/lib/db";
import { emit, events } from "../event-bus";

export interface Sandbox {
  sandboxId: string; root: string; executionId: string | null; projectId: string | null;
  port: number | null; pid: number | null; logPath: string; ttlSeconds: number;
  status: "ACTIVE" | "SNAPSHOTTED" | "CLEANED";
  healthCheck: "UNKNOWN" | "HEALTHY" | "UNHEALTHY" | "NOT_RUNNING";
  createdAt: Date; expiresAt: Date; processes: Set<ChildProcess>;
}

const SANDBOX_BASE = path.resolve(process.cwd(), ".genesis-sandboxes");
const DEFAULT_TTL = 86400;
const activeSandboxes = new Map<string, Sandbox>();
let sandboxCounter = 0;

async function nextSandboxId(): Promise<string> {
  if (sandboxCounter === 0) {
    try { const last = await db.sandbox.findFirst({ orderBy: { sandboxId: "desc" }, select: { sandboxId: true } }); if (last) { const m = last.sandboxId.match(/^SBX-(\d+)$/); if (m) sandboxCounter = parseInt(m[1], 10); } } catch {}
  }
  sandboxCounter++;
  return `SBX-${sandboxCounter.toString().padStart(6, "0")}`;
}

export async function createSandbox(opts?: { ttlSeconds?: number; executionId?: string; projectId?: string; port?: number; label?: string; }): Promise<Sandbox> {
  await fs.mkdir(SANDBOX_BASE, { recursive: true });
  const sandboxId = await nextSandboxId();
  const root = path.join(SANDBOX_BASE, sandboxId);
  const logPath = path.join(root, "logs");
  await fs.mkdir(logPath, { recursive: true });
  const now = new Date();
  const ttlSeconds = opts?.ttlSeconds ?? DEFAULT_TTL;
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  const sb: Sandbox = { sandboxId, root, logPath, executionId: opts?.executionId ?? null, projectId: opts?.projectId ?? null, port: opts?.port ?? null, pid: null, ttlSeconds, status: "ACTIVE", healthCheck: "UNKNOWN", createdAt: now, expiresAt, processes: new Set() };
  activeSandboxes.set(sandboxId, sb);
  try { await db.sandbox.create({ data: { sandboxId, executionId: opts?.executionId ?? null, projectId: opts?.projectId ?? null, path: root, status: "ACTIVE", healthCheck: "UNKNOWN", port: opts?.port ?? null, logPath, ttlSeconds } }); } catch (e) { console.error("[sandbox] DB create failed:", e instanceof Error ? e.message : e); }
  await emit(events.tool("SANDBOX", null, `created ${sandboxId}`));
  return sb;
}

export async function getSandbox(sandboxId: string): Promise<Sandbox | null> {
  const mem = activeSandboxes.get(sandboxId);
  if (mem) return mem;
  try {
    const row = await db.sandbox.findUnique({ where: { sandboxId } });
    if (!row) return null;
    const sb: Sandbox = { sandboxId: row.sandboxId, root: row.path, logPath: row.logPath ?? path.join(row.path, "logs"), executionId: row.executionId, projectId: row.projectId, port: row.port, pid: row.pid, ttlSeconds: row.ttlSeconds, status: row.status as Sandbox["status"], healthCheck: row.healthCheck as Sandbox["healthCheck"], createdAt: row.createdAt, expiresAt: new Date(row.createdAt.getTime() + row.ttlSeconds * 1000), processes: new Set() };
    if (sb.status === "ACTIVE") activeSandboxes.set(sandboxId, sb);
    return sb;
  } catch { return null; }
}

export async function runInSandbox(sandboxId: string, command: string, opts?: { timeoutMs?: number; env?: Record<string, string>; detach?: boolean; }) {
  const sb = activeSandboxes.get(sandboxId) ?? await getSandbox(sandboxId);
  if (!sb) throw new Error(`sandbox ${sandboxId} not found`);
  if (sb.status !== "ACTIVE") throw new Error(`sandbox ${sandboxId} is ${sb.status}`);
  const timeoutMs = Math.min(opts?.timeoutMs ?? 60_000, 600_000);
  const env = { ...process.env, ...opts?.env, CI: "1" };
  const stdoutPath = path.join(sb.logPath, "stdout.log");
  const stderrPath = path.join(sb.logPath, "stderr.log");
  await fs.mkdir(sb.logPath, { recursive: true });
  return new Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number; pid?: number }>((resolve) => {
    const start = Date.now();
    const child = spawn("/bin/sh", ["-c", command], { cwd: sb.root, env, stdio: ["ignore", "pipe", "pipe"], detached: Boolean(opts?.detach) });
    if (opts?.detach) { child.unref(); sb.processes.add(child); if (child.pid) { sb.pid = child.pid; db.sandbox.update({ where: { sandboxId }, data: { pid: child.pid } }).catch(() => {}); } }
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, timeoutMs);
    child.stdout?.on("data", (b: Buffer) => { const s = b.toString("utf8").slice(0, 200_000); stdout += s; fs.appendFile(stdoutPath, s).catch(() => {}); });
    child.stderr?.on("data", (b: Buffer) => { const s = b.toString("utf8").slice(0, 200_000); stderr += s; fs.appendFile(stderrPath, s).catch(() => {}); });
    child.on("error", (err) => { clearTimeout(timer); stderr += `[spawn error: ${err.message}]`; resolve({ exitCode: -1, stdout, stderr, durationMs: Date.now() - start, pid: child.pid }); });
    child.on("close", (code) => { clearTimeout(timer); if (opts?.detach) sb.processes.delete(child); resolve({ exitCode: typeof code === "number" ? code : -1, stdout, stderr, durationMs: Date.now() - start, pid: child.pid }); });
  });
}

export async function tailLogs(sandboxId: string, n = 100) {
  const sb = activeSandboxes.get(sandboxId) ?? await getSandbox(sandboxId);
  if (!sb) return { stdout: [] as string[], stderr: [] as string[] };
  const readTail = async (p: string): Promise<string[]> => { try { const content = await fs.readFile(p, "utf8"); return content.split("\n").slice(-Math.min(n, 5000)).filter(Boolean); } catch { return []; } };
  return { stdout: await readTail(path.join(sb.logPath, "stdout.log")), stderr: await readTail(path.join(sb.logPath, "stderr.log")) };
}

export async function healthCheck(url: string, opts?: { timeoutMs?: number; intervalMs?: number; }) {
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  const intervalMs = opts?.intervalMs ?? 500;
  const start = Date.now();
  let attempts = 0, lastErr = "";
  while (Date.now() - start < timeoutMs) {
    attempts++;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(intervalMs * 2 + 1000) });
      const body = await res.text().catch(() => "");
      if (res.ok) return { ok: true, status: res.status, body: body.slice(0, 500), attempts, durationMs: Date.now() - start };
      lastErr = `HTTP ${res.status}`;
    } catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { ok: false, status: null, body: lastErr, attempts, durationMs: Date.now() - start };
}

export async function updateSandboxHealth(sandboxId: string, health: Sandbox["healthCheck"]): Promise<void> {
  const sb = activeSandboxes.get(sandboxId); if (sb) sb.healthCheck = health;
  try { await db.sandbox.update({ where: { sandboxId }, data: { healthCheck: health } }); } catch {}
}

export async function cleanupSandbox(sandboxId: string): Promise<void> {
  const sb = activeSandboxes.get(sandboxId);
  if (sb) { for (const p of sb.processes) { try { p.kill("SIGKILL"); } catch {} } sb.processes.clear(); sb.status = "CLEANED"; }
  let root: string | undefined = sb?.root;
  if (!root) { try { const row = await db.sandbox.findUnique({ where: { sandboxId } }); root = row?.path ?? undefined; } catch {} }
  if (root) await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  try { await db.sandbox.update({ where: { sandboxId }, data: { status: "CLEANED", healthCheck: "NOT_RUNNING" } }); } catch {}
  activeSandboxes.delete(sandboxId);
  await emit(events.tool("SANDBOX", null, `cleaned up ${sandboxId}`));
}

export async function cleanupExpired(): Promise<number> {
  const now = new Date();
  let reaped = 0;
  try {
    const rows = await db.sandbox.findMany({ where: { status: "ACTIVE" } });
    for (const row of rows) {
      const expiresAt = new Date(row.createdAt.getTime() + row.ttlSeconds * 1000);
      if (expiresAt < now) { await cleanupSandbox(row.sandboxId); reaped++; }
    }
  } catch {}
  for (const [id, sb] of activeSandboxes) { if (sb.expiresAt < now) { await cleanupSandbox(id); reaped++; } }
  return reaped;
}

export async function listSandboxes(): Promise<Sandbox[]> {
  const all: Sandbox[] = [];
  const seen = new Set<string>();
  for (const sb of activeSandboxes.values()) { all.push(sb); seen.add(sb.sandboxId); }
  try {
    const rows = await db.sandbox.findMany({ where: { status: "ACTIVE" }, orderBy: { createdAt: "desc" } });
    for (const r of rows) {
      if (seen.has(r.sandboxId)) continue;
      all.push({ sandboxId: r.sandboxId, root: r.path, logPath: r.logPath ?? path.join(r.path, "logs"), executionId: r.executionId, projectId: r.projectId, port: r.port, pid: r.pid, ttlSeconds: r.ttlSeconds, status: r.status as Sandbox["status"], healthCheck: r.healthCheck as Sandbox["healthCheck"], createdAt: r.createdAt, expiresAt: new Date(r.createdAt.getTime() + r.ttlSeconds * 1000), processes: new Set() });
    }
  } catch {}
  return all;
}
