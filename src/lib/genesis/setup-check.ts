/** Setup Readiness (V10.1 app layer) — REAL environment/database/provider/Docker
 *  detection for the Setup Wizard and Operator dashboard. Every check reflects
 *  actual state; nothing is assumed. Reuses the existing health functions. */

import { db } from "@/lib/db";
import { validateEnv } from "@/lib/env";
import { availableProviders } from "./agent-runtime/router";
import { connectorHealth as actionHealth } from "./agent-runtime/action-connectors";
import { cloudProviderHealth } from "./agent-runtime/deployment-cloud/cloud-providers";
import { providerHealth as revenueHealth } from "./agent-runtime/revenue-engine/providers";
import { getConfigStatus } from "./app-config";

export type CheckStatus = "ok" | "warn" | "fail";
export interface Check { id: string; label: string; status: CheckStatus; detail: string; repair?: string }

async function checkDatabase(): Promise<Check> {
  try {
    await db.$queryRaw`SELECT 1`;
    // provisioned = the schema is applied (a known table is queryable)
    await db.activityLog.count();
    return { id: "database", label: "Database", status: "ok", detail: "connected and initialized" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const notInit = /no such table|does not exist/i.test(msg);
    return { id: "database", label: "Database", status: "fail", detail: notInit ? "reachable but not initialized" : `unreachable: ${msg.slice(0, 120)}`, repair: notInit ? "Run database initialization (prisma db push) — the Setup Wizard can do this." : "Check DATABASE_URL." };
  }
}

/** Best-effort Docker detection (optional — only needed for cloud deploy previews). */
async function checkDocker(): Promise<Check> {
  try {
    const proc = Bun.spawn(["docker", "version", "--format", "{{.Server.Version}}"], { stdout: "pipe", stderr: "pipe" });
    const out = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    if (proc.exitCode === 0 && out) return { id: "docker", label: "Docker", status: "ok", detail: `daemon ${out}` };
    return { id: "docker", label: "Docker", status: "warn", detail: "installed but daemon not responding", repair: "Start Docker Desktop (optional — only needed for container deploys)." };
  } catch {
    return { id: "docker", label: "Docker", status: "warn", detail: "not detected (optional)", repair: "Install Docker only if you want container deploys; Genesis runs without it." };
  }
}

export interface Readiness {
  ready: boolean;
  runtime: Check;
  database: Check;
  llm: Check;
  docker: Check;
  providers: { llm: string[]; action: number; cloud: number; revenue: number };
  env: ReturnType<typeof validateEnv>;
  config: Awaited<ReturnType<typeof getConfigStatus>>;
  summary: { ok: number; warn: number; fail: number };
}

/** Full readiness snapshot for the Setup Wizard + Operator health card. */
export async function setupReadiness(): Promise<Readiness> {
  const env = validateEnv();
  const runtime: Check = { id: "runtime", label: "Runtime", status: "ok", detail: `${typeof Bun !== "undefined" ? `Bun ${Bun.version}` : "Node"} · ${process.platform}` };
  const database = await checkDatabase();
  const docker = await checkDocker();

  const llmProviders = [...availableProviders()];
  const llm: Check = llmProviders.length > 0
    ? { id: "llm", label: "AI Provider", status: "ok", detail: `${llmProviders.length} configured: ${llmProviders.join(", ")}` }
    : { id: "llm", label: "AI Provider", status: "warn", detail: "none configured — agents use rule-based fallbacks", repair: "Add an AI provider key in Settings (Gemini has a free tier)." };

  const action = actionHealth().filter((c) => c.available).length;
  const cloud = cloudProviderHealth().filter((c) => c.available).length;
  const revenue = revenueHealth().filter((c) => c.available).length;

  const checks = [runtime, database, llm, docker];
  const summary = { ok: checks.filter((c) => c.status === "ok").length, warn: checks.filter((c) => c.status === "warn").length, fail: checks.filter((c) => c.status === "fail").length };
  // "ready" = the only hard requirement (database) is ok. LLM/docker are optional.
  return { ready: database.status === "ok", runtime, database, llm, docker, providers: { llm: llmProviders, action, cloud, revenue }, env, config: await getConfigStatus(), summary };
}
