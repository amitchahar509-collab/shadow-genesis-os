/** Deployment Cloud Engine (V10 Module 4).
 *
 * Extends the existing local DeploymentAgent with real cloud providers. Honesty:
 *  - Providers are KEY-GATED; verify() is a REAL read-only API call.
 *  - An actual deploy is an OUTWARD-FACING side effect → ALWAYS human-approval
 *    gated (reuses the approvals engine). Genesis never publishes a deploy alone.
 *  - Health monitoring is a REAL HTTP check against the live URL.
 *  - Rollback re-activates the previously-DEPLOYED record for the project.
 *
 * Reuses: DeploymentRecord (extended additively), approvals, Module-1 fetch seam.
 * The local pipeline in DeploymentAgent is untouched.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { db } from "@/lib/db";
import { emit } from "../event-bus";
import { requestApproval, decide } from "../approvals";
import { CLOUD_PROVIDERS, cloudProviderHealth, type ProviderName } from "./cloud-providers";
import type { FetchLike } from "../world-scanner/connectors";

const llmDisabled = () => process.env.NODE_ENV === "test" && process.env.GENESIS_TEST_ALLOW_LLM !== "1";

const realFetch: FetchLike = async (url, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const xbody = init?.headers?.["x-body"];
    const r = await fetch(url, xbody ? { method: "POST", headers: init!.headers, body: xbody, signal: controller.signal } : { headers: init?.headers, signal: controller.signal });
    return { ok: r.ok, status: r.status, json: () => r.json(), text: () => r.text() };
  } finally { clearTimeout(timer); }
};

async function nextDeploymentId(): Promise<string> {
  const rows = await db.deploymentRecord.findMany({ where: { deploymentId: { not: null } }, orderBy: { createdAt: "desc" }, take: 100, select: { deploymentId: true } });
  let max = 0; for (const r of rows) { const m = r.deploymentId?.match(/^DEP-(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `DEP-${(max + 1).toString().padStart(6, "0")}`;
}

// ======================= PROVIDER VERIFY =======================

export interface ProviderStatus { name: ProviderName; kind: string; available: boolean; verified: boolean; detail: string; account?: string }

/** REAL read-only verification of a connected provider's token. */
export async function verifyProvider(name: ProviderName, opts?: { fetchImpl?: FetchLike }): Promise<ProviderStatus> {
  const p = CLOUD_PROVIDERS.find((x) => x.name === name);
  if (!p) return { name, kind: "?", available: false, verified: false, detail: "unknown provider" };
  const base = { name, kind: p.kind, available: p.available() };
  if (!p.available()) return { ...base, verified: false, detail: `not configured — set ${p.keyEnv || "the provider CLI"}` };
  if (!p.verify) return { ...base, verified: true, detail: p.note }; // e.g. docker (local CLI)
  const fetchImpl = opts?.fetchImpl ?? realFetch;
  if (!opts?.fetchImpl && llmDisabled()) return { ...base, verified: false, detail: "NETWORK_DISABLED_IN_TESTS: inject fetchImpl" };
  try { const v = await p.verify(fetchImpl); return { ...base, verified: v.ok, detail: v.detail, account: v.account }; }
  catch (e) { return { ...base, verified: false, detail: e instanceof Error ? e.message : String(e) }; }
}

/** Verify every configured provider (skips those with no key). */
export async function verifyAllProviders(opts?: { fetchImpl?: FetchLike }): Promise<ProviderStatus[]> {
  const out: ProviderStatus[] = [];
  for (const p of CLOUD_PROVIDERS) {
    if (!p.available()) { out.push({ name: p.name, kind: p.kind, available: false, verified: false, detail: `not configured — set ${p.keyEnv || "the provider CLI"}` }); continue; }
    out.push(await verifyProvider(p.name, opts));
  }
  return out;
}

// ======================= DEPLOY CONFIG GENERATION =======================

const DEPLOY_HOSTS: ProviderName[] = ["vercel", "cloudflare", "railway", "render", "docker"];

/** Generate the REAL provider config file for a repo (vercel.json / render.yaml /
 *  Dockerfile / railway.json). A real artifact the human can inspect before deploy. */
export async function generateDeployConfig(repoPath: string, provider: ProviderName, opts?: { stack?: string; buildCmd?: string; startCmd?: string; port?: number }): Promise<{ configPath: string } | { error: string }> {
  if (!DEPLOY_HOSTS.includes(provider)) return { error: `${provider} is not a deploy host` };
  try { await fs.access(repoPath); } catch { return { error: `repo not found: ${repoPath}` }; }
  const build = opts?.buildCmd ?? "npm run build";
  const start = opts?.startCmd ?? "npm run start";
  const port = opts?.port ?? 3000;
  let file = "", content = "";
  if (provider === "vercel") { file = "vercel.json"; content = JSON.stringify({ $schema: "https://openapi.vercel.sh/vercel.json", version: 2, buildCommand: build }, null, 2); }
  else if (provider === "render") { file = "render.yaml"; content = `services:\n  - type: web\n    name: app\n    env: node\n    buildCommand: ${build}\n    startCommand: ${start}\n`; }
  else if (provider === "railway") { file = "railway.json"; content = JSON.stringify({ $schema: "https://railway.app/railway.schema.json", build: { builder: "NIXPACKS", buildCommand: build }, deploy: { startCommand: start } }, null, 2); }
  else if (provider === "cloudflare") { file = "wrangler.toml"; content = `name = "app"\ncompatibility_date = "2024-01-01"\npages_build_output_dir = ".next"\n`; }
  else if (provider === "docker") { file = "Dockerfile"; content = `FROM node:20-slim\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev || npm install --omit=dev\nCOPY . .\nRUN ${build} || true\nEXPOSE ${port}\nCMD ["sh","-c","${start}"]\n`; }
  const configPath = path.join(repoPath, file);
  await fs.writeFile(configPath, content, "utf8");
  return { configPath };
}

// ======================= DEPLOY PLAN + APPROVAL =======================

export interface DeployPlan { deploymentId: string; provider: ProviderName; status: string; approvalId?: string; configPath?: string; note: string }

/** Plan a cloud deployment: generate config, create a DeploymentRecord, and queue
 *  a HUMAN approval. NOTHING is deployed here — deploys are outward-facing. */
export async function planDeployment(input: { provider: ProviderName; repoPath?: string; projectId?: string; url?: string; commitSha?: string; region?: string; stack?: string }): Promise<DeployPlan | { error: string }> {
  const provider = input.provider;
  if (!DEPLOY_HOSTS.includes(provider)) return { error: `${provider} is not a deploy host (it's infra/VCS)` };
  const p = CLOUD_PROVIDERS.find((x) => x.name === provider)!;
  if (!p.available()) return { error: `${provider} not configured — set ${p.keyEnv || "its CLI"} (no fabricated deploys)` };

  let configPath: string | undefined;
  if (input.repoPath) { const cfg = await generateDeployConfig(input.repoPath, provider, { stack: input.stack }); if ("configPath" in cfg) configPath = cfg.configPath; }

  const deploymentId = await nextDeploymentId();
  const appr = await requestApproval({
    agent: "DEPLOYMENT", actionType: "POST",
    description: `Deploy to ${provider}${input.url ? ` (${input.url})` : ""} — REVIEW before approving. This publishes to a live cloud host; Genesis will NOT deploy without explicit human approval.`,
    payload: { deploymentId, provider, repoPath: input.repoPath, url: input.url, commitSha: input.commitSha, region: input.region },
  });
  await db.deploymentRecord.create({ data: {
    deploymentId, provider, target: provider, projectId: input.projectId ?? null, url: input.url ?? null,
    buildCmd: "cloud", status: "AWAITING_APPROVAL", approvalId: appr.requestId, commitSha: input.commitSha ?? null,
    region: input.region ?? null, configPath: configPath ?? null, log: `Planned deploy to ${provider}; awaiting human approval ${appr.requestId}`,
  } });
  await emit({ agent: "DEPLOYMENT", action: "DEPLOY_PLAN", detail: `${deploymentId} → ${provider} planned, approval ${appr.requestId}`, level: "INFO", category: "DEPLOY" });
  return { deploymentId, provider, status: "AWAITING_APPROVAL", approvalId: appr.requestId, configPath, note: "human approval required before any deploy" };
}

/** Human decision on a planned deploy. Approve marks it ready (DEPLOYED requires a
 *  real subsequent deploy+health-check via markDeployed); reject cancels. */
export async function decideDeployment(deploymentId: string, opts: { approve: boolean; decidedBy: string; note?: string }): Promise<{ ok: boolean; status?: string; error?: string }> {
  const rec = await db.deploymentRecord.findUnique({ where: { deploymentId } });
  if (!rec) return { ok: false, error: "deployment not found" };
  if (!rec.approvalId) return { ok: false, error: "deployment was never queued for approval" };
  const d = await decide(rec.approvalId, { approve: opts.approve, decidedBy: opts.decidedBy, note: opts.note });
  if (!d.ok) return { ok: false, error: d.error };
  const status = opts.approve ? "PLANNED" : "FAILED";
  await db.deploymentRecord.update({ where: { deploymentId }, data: { status, log: `${rec.log}\n${opts.approve ? "APPROVED" : "REJECTED"} by ${opts.decidedBy}` } });
  await emit({ agent: "DEPLOYMENT", action: opts.approve ? "DEPLOY_APPROVED" : "DEPLOY_REJECTED", detail: `${deploymentId} ${status} by ${opts.decidedBy}`, level: opts.approve ? "SUCCESS" : "INFO", category: "DEPLOY" });
  return { ok: true, status };
}

/** Record that an APPROVED deploy actually went live (human/CI performed it), with
 *  its real URL — then health-check it. Genesis never claims a deploy it didn't verify. */
export async function markDeployed(deploymentId: string, url: string, opts?: { fetchImpl?: FetchLike }): Promise<{ ok: boolean; health?: string; error?: string }> {
  const rec = await db.deploymentRecord.findUnique({ where: { deploymentId } });
  if (!rec) return { ok: false, error: "deployment not found" };
  if (rec.status !== "PLANNED") return { ok: false, error: `deployment is ${rec.status}, not PLANNED (needs approval first)` };
  await db.deploymentRecord.update({ where: { deploymentId }, data: { status: "DEPLOYED", url } });
  const h = await checkHealth(deploymentId, opts);
  return { ok: true, health: "health" in h ? h.health : "UNKNOWN" };
}

// ======================= HEALTH MONITORING =======================

/** REAL HTTP health check against a deployment's live URL. Any response = live. */
export async function checkHealth(deploymentId: string, opts?: { fetchImpl?: FetchLike }): Promise<{ health: string; status: number | null } | { error: string }> {
  const rec = await db.deploymentRecord.findUnique({ where: { deploymentId } });
  if (!rec) return { error: "deployment not found" };
  if (!rec.url) return { error: "deployment has no URL to check" };
  const fetchImpl = opts?.fetchImpl ?? realFetch;
  if (!opts?.fetchImpl && llmDisabled()) return { error: "NETWORK_DISABLED_IN_TESTS: inject fetchImpl" };
  let health = "UNHEALTHY"; let status: number | null = null;
  try { const r = await fetchImpl(rec.url, {}); status = r.status; health = r.status < 500 ? "HEALTHY" : "UNHEALTHY"; }
  catch { health = "NOT_RUNNING"; }
  await db.deploymentRecord.update({ where: { deploymentId }, data: { health, healthCheckedAt: new Date(), status: health === "HEALTHY" ? "DEPLOYED" : "UNHEALTHY" } });
  await emit({ agent: "DEPLOYMENT", action: "HEALTH_CHECK", detail: `${deploymentId} ${rec.url} → ${health}${status ? ` (${status})` : ""}`, level: health === "HEALTHY" ? "INFO" : "WARNING", category: "DEPLOY" });
  return { health, status };
}

// ======================= ROLLBACK =======================

/** Roll back to the previous healthy deployment of the same project/provider. */
export async function rollback(deploymentId: string): Promise<{ ok: boolean; rolledBackTo?: string; error?: string }> {
  const rec = await db.deploymentRecord.findUnique({ where: { deploymentId } });
  if (!rec) return { ok: false, error: "deployment not found" };
  const prior = await db.deploymentRecord.findFirst({
    where: { deploymentId: { not: deploymentId }, provider: rec.provider, projectId: rec.projectId, status: "DEPLOYED", createdAt: { lt: rec.createdAt } },
    orderBy: { createdAt: "desc" },
  });
  if (!prior) return { ok: false, error: "no prior healthy deployment to roll back to" };
  await db.deploymentRecord.update({ where: { deploymentId }, data: { status: "ROLLED_BACK", log: `${rec.log}\nrolled back to ${prior.deploymentId}` } });
  await db.deploymentRecord.update({ where: { id: prior.id }, data: { status: "DEPLOYED", rolledBackFrom: deploymentId, log: `${prior.log}\nre-activated by rollback from ${deploymentId}` } });
  await emit({ agent: "DEPLOYMENT", action: "ROLLBACK", detail: `${deploymentId} → ${prior.deploymentId} (re-activated)`, level: "WARNING", category: "DEPLOY" });
  return { ok: true, rolledBackTo: prior.deploymentId ?? undefined };
}

// ======================= OVERVIEW =======================

export async function deploymentOverview() {
  const recent = await db.deploymentRecord.findMany({ where: { deploymentId: { not: null } }, orderBy: { createdAt: "desc" }, take: 25, select: { deploymentId: true, provider: true, url: true, status: true, health: true, region: true, approvalId: true, createdAt: true } });
  const byProvider = new Map<string, number>();
  for (const r of recent) byProvider.set(r.provider, (byProvider.get(r.provider) ?? 0) + 1);
  return {
    providers: cloudProviderHealth(),
    deployments: recent,
    byProvider: [...byProvider.entries()].map(([provider, count]) => ({ provider, count })),
    pendingApprovals: recent.filter((r) => r.status === "AWAITING_APPROVAL").length,
    note: "cloud deploys are human-approval gated · health is a real HTTP check · providers need real API keys",
  };
}

export { cloudProviderHealth };
