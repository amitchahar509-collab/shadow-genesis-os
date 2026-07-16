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

/** Poll a URL until it answers (any HTTP response = listening). The WMI launch
 *  path adds powershell+cmd+bun startup (~2-5s), so a single fixed-delay check
 *  produces false UNHEALTHY verdicts — poll instead. */
export async function waitForHttp(url: string, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await fetch(url, { signal: AbortSignal.timeout(1500) }).then(() => true).catch(() => false);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
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

/** Spawn the app fully detached so it outlives this process. Returns its pid.
 *
 *  CRITICAL — stdio MUST be "ignore". Handing our own file descriptors to the
 *  child makes Windows spawn it with bInheritHandles=TRUE, which also hands over
 *  Genesis's LISTENING SOCKET. The child then pins Genesis's port for its whole
 *  life, so the next Genesis start dies with EADDRINUSE ("Failed to start
 *  server. Is port X in use?") and silently exits — leaving nothing serving and
 *  no reconciliation to revive anything. Let the shell own the redirection so we
 *  inherit nothing to the child. */
export async function startLocalDetached(opts: { repoPath: string; port: number; logPath: string }): Promise<{ pid?: number; runCmd: string } | { error: string }> {
  const args = await deriveRunArgs(opts.repoPath);
  if (!args) return { error: "no start script in package.json" };

  if (process.platform === "win32") {
    // On Windows, Node's spawn sets bInheritHandles=TRUE even with stdio:"ignore",
    // so a direct child inherits Genesis's LISTENING SOCKET and pins Genesis's
    // port for its whole life — the next Genesis start then dies with EADDRINUSE
    // and exits silently. PROVEN by execution: killing the child apps freed the
    // dead server's port instantly. So ask WMI to create the process instead:
    // WmiPrvSE becomes the parent and the app inherits nothing from us. The
    // transient powershell launcher below exits in ~1s; only IT briefly inherits.
    //
    // cmd /c with an outer-quoted line that contains inner quotes strips exactly
    // the first and last quote — the same pattern verified working for launching
    // Genesis itself. Inside a PowerShell SINGLE-quoted string, only ' needs
    // escaping ('' ) — double quotes pass through literally.
    const cmdLine = `cmd.exe /c "set PORT=${opts.port}&& set NODE_ENV=production&& "${process.execPath}" ${args.join(" ")} > "${opts.logPath}" 2>&1"`;
    const psQuote = (s: string) => s.replace(/'/g, "''");
    const ps = `$r=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='${psQuote(cmdLine)}';CurrentDirectory='${psQuote(opts.repoPath)}'}; if($r.ReturnValue -eq 0){Write-Output $r.ProcessId}else{Write-Output ('ERR:'+$r.ReturnValue)}`;
    const out = await new Promise<string>((resolve) => {
      const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
      let s = ""; p.stdout.on("data", (b: Buffer) => (s += b.toString()));
      p.on("close", () => resolve(s.trim())); p.on("error", () => resolve(""));
    });
    const pid = /^\d+$/.test(out) ? Number(out) : undefined;
    return pid ? { pid, runCmd: `bun ${args.join(" ")}` } : { error: `WMI launch failed: ${out || "no output"}` };
  }

  // POSIX: sockets are close-on-exec, so a detached spawn inherits nothing.
  const child = spawn(process.execPath, args, {
    cwd: opts.repoPath,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, PORT: String(opts.port), NODE_ENV: "production" },
  });
  child.unref();
  return { pid: child.pid, runCmd: `bun ${args.join(" ")}` };
}

/** Boot-time reconciliation: make every local deploy reachable whenever Genesis
 *  is up. Health-check each recorded local deploy; if it survived, mark HEALTHY;
 *  if it died (machine reboot, crash, blanket kill), REVIVE it from its repo so
 *  the user's URL just works. Deduped by URL so historical rows that shared a
 *  port don't spawn duplicates — only the newest record per URL is revived. */
export async function reconcileLocalDeploys(): Promise<{ checked: number; alive: number; revived: number }> {
  const recs = await db.deploymentRecord
    .findMany({ where: { target: "local", status: "DEPLOYED", url: { not: null } }, orderBy: { createdAt: "desc" }, select: { id: true, url: true } })
    .catch(() => [] as { id: string; url: string | null }[]);
  let alive = 0, revived = 0, checked = 0;
  const seenUrl = new Set<string>();
  for (const r of recs) {
    if (!r.url || seenUrl.has(r.url)) continue; // newest record per URL only
    seenUrl.add(r.url);
    checked++;
    const ok = await fetch(r.url, { signal: AbortSignal.timeout(1500) }).then(() => true).catch(() => false);
    if (ok) { alive++; await db.deploymentRecord.update({ where: { id: r.id }, data: { health: "HEALTHY" } }).catch(() => {}); continue; }
    // Dead — bring it back so the URL is reachable now that Genesis is running.
    const res = await restartLocalDeploy(r.id).catch(() => ({ ok: false as const }));
    if (res.ok) { alive++; revived++; }
    else await db.deploymentRecord.update({ where: { id: r.id }, data: { health: "NOT_RUNNING" } }).catch(() => {});
  }
  if (checked) await emit({ agent: "DEPLOYMENT", action: "RECONCILE", detail: `local deploys: ${alive}/${checked} reachable (${revived} auto-revived)`, level: "INFO", category: "DEPLOY" }).catch(() => {});
  return { checked, alive, revived };
}

/** Relaunch a stopped local deploy from its recorded repo (detached). */
export async function restartLocalDeploy(recordId: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  const rec = await db.deploymentRecord.findUnique({ where: { id: recordId } }).catch(() => null);
  if (!rec) return { ok: false, error: "deployment not found" };
  if (rec.target !== "local") return { ok: false, error: "only local deploys can be restarted here" };

  // The record stores its repoPath directly (new column); artifacts are only a
  // fallback for legacy rows created before the column existed.
  const art = rec.repoPath
    ? null
    : (await db.artifact.findFirst({ where: { taskId: rec.taskId ?? undefined, type: "DEPLOYMENT" }, orderBy: { createdAt: "desc" }, select: { path: true } }).catch(() => null)) ??
      (await db.artifact.findFirst({ where: { taskId: rec.taskId ?? undefined, type: "REPOSITORY" }, orderBy: { createdAt: "desc" }, select: { path: true } }).catch(() => null));
  const repoPath = rec.repoPath ?? art?.path;
  if (!repoPath) return { ok: false, error: "repo path not recorded and not recoverable from artifacts" };

  // If it's already serving, nothing to do.
  const recPort = rec.url ? Number(new URL(rec.url).port) || 0 : 0;
  if (recPort && (await isPortAlive(recPort))) {
    await db.deploymentRecord.update({ where: { id: rec.id }, data: { health: "HEALTHY", status: "DEPLOYED" } }).catch(() => {});
    return { ok: true, url: rec.url ?? undefined };
  }

  const port = recPort && !(await isPortAlive(recPort)) ? recPort : await findFreePort(3001);
  const started = await startLocalDetached({ repoPath, port, logPath: path.join(repoPath, `deploy-${rec.id}.log`) });
  if ("error" in started) return { ok: false, error: started.error };

  const url = `http://localhost:${port}`;
  const healthOk = await waitForHttp(url, 15_000);
  await db.deploymentRecord.update({ where: { id: rec.id }, data: { url, status: healthOk ? "DEPLOYED" : "UNHEALTHY", health: healthOk ? "HEALTHY" : "NOT_RUNNING", log: `restarted (pid ${started.pid ?? "?"}) → ${healthOk ? "healthy" : "no response"}` } }).catch(() => {});
  await emit({ agent: "DEPLOYMENT", action: "RESTART", detail: `restarted local deploy ${rec.id} → ${url} (${healthOk ? "healthy" : "no response"})`, level: healthOk ? "SUCCESS" : "WARNING", category: "DEPLOY" }).catch(() => {});
  return healthOk ? { ok: true, url } : { ok: false, error: `restarted but no response at ${url}` };
}
