/** V10 Module 4 — Deployment Cloud. Key-gated real providers, approval-gated
 *  deploys (never auto-published), real HTTP health checks, rollback. Network-free
 *  via injected fetch seam; no fabricated deploys. */

import { test, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { db } from "@/lib/db";
import {
  verifyProvider, generateDeployConfig, planDeployment, decideDeployment,
  markDeployed, checkHealth, rollback,
} from "@/lib/genesis/agent-runtime/deployment-cloud";
import type { FetchLike } from "@/lib/genesis/agent-runtime/world-scanner/connectors";

const KEYS = ["VERCEL_TOKEN", "CLOUDFLARE_API_TOKEN", "RAILWAY_TOKEN", "RENDER_API_KEY", "GITHUB_TOKEN", "SUPABASE_ACCESS_TOKEN", "NEON_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];

const okFetch: FetchLike = async (url) => ({ ok: true, status: 200, json: async () => (url.includes("vercel") ? { user: { username: "acme" } } : { success: true }), text: async () => "ok" });
const healthyFetch: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "<html>live</html>" });
const downFetch: FetchLike = async () => { throw new Error("ECONNREFUSED"); };

const TMP = path.join(process.cwd(), ".genesis-workspace", "DEPTEST_repo");

async function wipe() {
  const recs = await db.deploymentRecord.findMany({ where: { OR: [{ projectId: { startsWith: "DEPTEST" } }, { provider: { in: ["vercel", "render", "docker"] } }] }, select: { deploymentId: true } });
  for (const r of recs) if (r.deploymentId) await db.deploymentRecord.deleteMany({ where: { deploymentId: r.deploymentId } });
  await db.approvalRequest.deleteMany({ where: { agent: "DEPLOYMENT" } });
}
beforeEach(async () => { for (const k of KEYS) delete process.env[k]; await wipe(); await fs.mkdir(TMP, { recursive: true }); await fs.writeFile(path.join(TMP, "package.json"), "{}"); });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
afterAll(async () => { await wipe(); await fs.rm(TMP, { recursive: true, force: true }).catch(() => {}); });

test("provider verify is KEY-GATED — no key → honestly unconfigured, no network", async () => {
  const r = await verifyProvider("vercel", { fetchImpl: okFetch });
  expect(r.available).toBe(false);
  expect(r.verified).toBe(false);
  expect(r.detail).toContain("not configured");
});

test("connected provider verify makes a REAL read-only call and reports the account", async () => {
  process.env.VERCEL_TOKEN = "tok_DEPTEST";
  const r = await verifyProvider("vercel", { fetchImpl: okFetch });
  expect(r.available).toBe(true);
  expect(r.verified).toBe(true);
  expect(r.account).toBe("acme");
});

test("generateDeployConfig writes a REAL provider config file", async () => {
  const r = await generateDeployConfig(TMP, "docker", { buildCmd: "bun run build", startCmd: "bun run start", port: 3000 });
  expect("configPath" in r).toBe(true);
  const content = await fs.readFile(path.join(TMP, "Dockerfile"), "utf8");
  expect(content).toContain("FROM node:20-slim");
  expect(content).toContain("EXPOSE 3000");
  const v = await generateDeployConfig(TMP, "vercel");
  expect("configPath" in v).toBe(true);
  expect(JSON.parse(await fs.readFile(path.join(TMP, "vercel.json"), "utf8")).version).toBe(2);
});

test("planDeployment is APPROVAL-GATED and never deploys on its own", async () => {
  process.env.VERCEL_TOKEN = "tok_DEPTEST";
  const plan = await planDeployment({ provider: "vercel", repoPath: TMP, projectId: "DEPTEST-p1", url: "https://depTEST.vercel.app" }) as { deploymentId: string; approvalId: string; status: string };
  expect(plan.status).toBe("AWAITING_APPROVAL");
  expect(plan.approvalId).toMatch(/^APR-/);
  const rec = await db.deploymentRecord.findUnique({ where: { deploymentId: plan.deploymentId } });
  expect(rec!.status).toBe("AWAITING_APPROVAL"); // not deployed

  // cannot mark deployed before approval
  expect((await markDeployed(plan.deploymentId, "https://depTEST.vercel.app")).ok).toBe(false);
});

test("plan refuses an unconfigured provider (no fabricated deploys)", async () => {
  const r = await planDeployment({ provider: "vercel", projectId: "DEPTEST-x" });
  expect("error" in r).toBe(true);
  if ("error" in r) expect(r.error).toContain("not configured");
});

test("approve → deploy → REAL health check marks it HEALTHY", async () => {
  process.env.RENDER_API_KEY = "key_DEPTEST";
  const plan = await planDeployment({ provider: "render", repoPath: TMP, projectId: "DEPTEST-p2", url: "https://depTEST.onrender.com" }) as { deploymentId: string };
  await decideDeployment(plan.deploymentId, { approve: true, decidedBy: "operator" });
  expect((await db.deploymentRecord.findUnique({ where: { deploymentId: plan.deploymentId } }))!.status).toBe("PLANNED");
  const md = await markDeployed(plan.deploymentId, "https://depTEST.onrender.com", { fetchImpl: healthyFetch });
  expect(md.ok).toBe(true);
  expect(md.health).toBe("HEALTHY");
  const rec = await db.deploymentRecord.findUnique({ where: { deploymentId: plan.deploymentId } });
  expect(rec!.status).toBe("DEPLOYED");
  expect(rec!.healthCheckedAt).not.toBeNull();
});

test("rejected deploy cannot be marked deployed", async () => {
  process.env.VERCEL_TOKEN = "tok_DEPTEST";
  const plan = await planDeployment({ provider: "vercel", projectId: "DEPTEST-p3", url: "https://x.vercel.app" }) as { deploymentId: string };
  await decideDeployment(plan.deploymentId, { approve: false, decidedBy: "operator", note: "wrong env" });
  expect((await db.deploymentRecord.findUnique({ where: { deploymentId: plan.deploymentId } }))!.status).toBe("FAILED");
  expect((await markDeployed(plan.deploymentId, "https://x.vercel.app")).ok).toBe(false);
});

test("health check reflects a REAL down server", async () => {
  process.env.VERCEL_TOKEN = "tok_DEPTEST";
  const plan = await planDeployment({ provider: "vercel", projectId: "DEPTEST-p4", url: "https://down.vercel.app" }) as { deploymentId: string };
  await decideDeployment(plan.deploymentId, { approve: true, decidedBy: "operator" });
  await markDeployed(plan.deploymentId, "https://down.vercel.app", { fetchImpl: downFetch });
  const h = await checkHealth(plan.deploymentId, { fetchImpl: downFetch }) as { health: string };
  expect(h.health).toBe("NOT_RUNNING");
});

test("rollback re-activates the previous healthy deployment", async () => {
  process.env.VERCEL_TOKEN = "tok_DEPTEST";
  // first healthy deploy
  const p1 = await planDeployment({ provider: "vercel", projectId: "DEPTEST-roll", url: "https://v1.vercel.app" }) as { deploymentId: string };
  await decideDeployment(p1.deploymentId, { approve: true, decidedBy: "op" });
  await markDeployed(p1.deploymentId, "https://v1.vercel.app", { fetchImpl: healthyFetch });
  // second deploy goes bad
  const p2 = await planDeployment({ provider: "vercel", projectId: "DEPTEST-roll", url: "https://v2.vercel.app" }) as { deploymentId: string };
  await decideDeployment(p2.deploymentId, { approve: true, decidedBy: "op" });
  await markDeployed(p2.deploymentId, "https://v2.vercel.app", { fetchImpl: healthyFetch });
  const rb = await rollback(p2.deploymentId);
  expect(rb.ok).toBe(true);
  expect(rb.rolledBackTo).toBe(p1.deploymentId);
  expect((await db.deploymentRecord.findUnique({ where: { deploymentId: p2.deploymentId } }))!.status).toBe("ROLLED_BACK");
  expect((await db.deploymentRecord.findUnique({ where: { deploymentId: p1.deploymentId } }))!.status).toBe("DEPLOYED");
});

test("test-env network lockout: verify without a seam touches no network", async () => {
  process.env.VERCEL_TOKEN = "tok_DEPTEST";
  const r = await verifyProvider("vercel"); // no fetchImpl
  expect(r.verified).toBe(false);
  expect(r.detail).toContain("NETWORK_DISABLED_IN_TESTS");
});
