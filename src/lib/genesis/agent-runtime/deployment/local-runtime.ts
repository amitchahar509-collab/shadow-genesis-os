/** Local deploy runtime — launch generated apps so they OUTLIVE Genesis.
 *
 * Previously a local deploy was started with `nohup … &` through the terminal
 * tool, so the app was a child in Genesis's process group and died when Genesis
 * stopped or its console closed. Here we spawn it truly detached (own process
 * group, no inherited console, unref'd) so it survives a Genesis restart, plus:
 *   - findFreePort:            a surviving deploy no longer blocks the next one.
 *   - reconcileLocalDeploys(): on boot, health-check recorded local deploys and
 *                              mark them HEALTHY (survived) or NOT_RUNNING.
 *   - restartLocalDeploy():    relaunch a stopped one from its recorded repo.
 */
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import net from "node:net";
import { db } from "@/lib/db";
import { emit } from "../event-bus";

/** First free TCP port at or after `start` (bounded scan). */
export async function findFreePort(start = 3001, tries = 100): Promise<number> {
  for (let p = start; p < start + tries; p++) {
    const free = await new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.once("error", () => resolve(false));
      srv.once("listening", () => srv.close(() => resolve(true)));
      srv.listen(p, "127.0.0.1");
    });
    if (free) return p;
  }
  return start;
}

async function isPortAlive(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
    s.setTimeout(1000, () => { s.destroy(); resolve(false); });
  });
}

/** Re-derive the run command from the repo's package.json start script.
 *  `node <entry>` is executed via bun (the host may not have node). */
export async function deriveRunArgs(repoPath: string): Promise<string[] | null> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(repoPath, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    const start = pkg.scripts?.start ?? "";
    if (!start) return null;
    const nodeEntry = start.match(/^node\s+(\S+)$/)?.[1];
    return nodeEntry ? [nodeEntry] : ["run", "start"];
  } catch { return null; }
}

/** Spawn the app fully detached so it outlives this process. Returns its pid. */
export async function startLocalDetached(opts: { repoPath: string; port: number; logPath: string }): Promise<{ pid?: number; runCmd: string } | { error: string }> {
  const args = await deriveRunArgs(opts.repoPath);
  if (!args) return { error: "no start script in package.json" };
  // Own log fd (not closed — the detached child inherits it and keeps writing).
  const out = openSync(opts.logPath, "a");
  const child = spawn(process.execPath, args, {
    cwd: opts.repoPath,
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: true,
    env: { ...process.env, PORT: String(opts.port), NODE_ENV: "production" },
  });
  child.unref();
  return { pid: child.pid, runCmd: `bun ${args.join(" ")}` };
}

/** Boot-time reconciliation: reflect the REAL state of recorded local deploys so
 *  the UI shows what actually survived the restart. Never fabricates liveness. */
export async function reconcileLocalDeploys(): Promise<{ checked: number; alive: number }> {
  const recs = await db.deploymentRecord
    .findMany({ where: { target: "local", status: "DEPLOYED", url: { not: null } }, select: { id: true, url: true } })
    .catch(() => [] as { id: string; url: string | null }[]);
  let alive = 0;
  for (const r of recs) {
    if (!r.url) continue;
    const ok = await fetch(r.url, { signal: AbortSignal.timeout(1500) }).then(() => true).catch(() => false);
    if (ok) alive++;
    await db.deploymentRecord.update({ where: { id: r.id }, data: { health: ok ? "HEALTHY" : "NOT_RUNNING" } }).catch(() => {});
  }
  if (recs.length) await emit({ agent: "DEPLOYMENT", action: "RECONCILE", detail: `local deploys: ${alive}/${recs.length} still serving after restart`, level: "INFO", category: "DEPLOY" }).catch(() => {});
  return { checked: recs.length, alive };
}

/** Relaunch a stopped local deploy from its recorded repo (detached). */
export async function restartLocalDeploy(recordId: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  const rec = await db.deploymentRecord.findUnique({ where: { id: recordId } }).catch(() => null);
  if (!rec) return { ok: false, error: "deployment not found" };
  if (rec.target !== "local") return { ok: false, error: "only local deploys can be restarted here" };

  // Recover the app's repo path from its artifacts.
  const art =
    (await db.artifact.findFirst({ where: { taskId: rec.taskId ?? undefined, type: "DEPLOYMENT" }, orderBy: { createdAt: "desc" }, select: { path: true } }).catch(() => null)) ??
    (await db.artifact.findFirst({ where: { taskId: rec.taskId ?? undefined, type: "REPOSITORY" }, orderBy: { createdAt: "desc" }, select: { path: true } }).catch(() => null));
  const repoPath = art?.path;
  if (!repoPath) return { ok: false, error: "repo path not recoverable from artifacts" };

  // If it's already serving, nothing to do.
  const recPort = rec.url ? Number(new URL(rec.url).port) || 0 : 0;
  if (recPort && (await isPortAlive(recPort))) {
    await db.deploymentRecord.update({ where: { id: rec.id }, data: { health: "HEALTHY", status: "DEPLOYED" } }).catch(() => {});
    return { ok: true, url: rec.url ?? undefined };
  }

  const port = recPort && !(await isPortAlive(recPort)) ? recPort : await findFreePort(3001);
  const started = await startLocalDetached({ repoPath, port, logPath: path.join(repoPath, `deploy-${rec.id}.log`) });
  if ("error" in started) return { ok: false, error: started.error };

  await new Promise((r) => setTimeout(r, 3000));
  const url = `http://localhost:${port}`;
  const healthOk = await fetch(url, { signal: AbortSignal.timeout(2000) }).then(() => true).catch(() => false);
  await db.deploymentRecord.update({ where: { id: rec.id }, data: { url, status: healthOk ? "DEPLOYED" : "UNHEALTHY", health: healthOk ? "HEALTHY" : "NOT_RUNNING", log: `restarted (pid ${started.pid ?? "?"}) → ${healthOk ? "healthy" : "no response"}` } }).catch(() => {});
  await emit({ agent: "DEPLOYMENT", action: "RESTART", detail: `restarted local deploy ${rec.id} → ${url} (${healthOk ? "healthy" : "no response"})`, level: healthOk ? "SUCCESS" : "WARNING", category: "DEPLOY" }).catch(() => {});
  return healthOk ? { ok: true, url } : { ok: false, error: `restarted but no response at ${url}` };
}
