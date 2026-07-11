/** Cloud provider connectors (V10 Module 4) — REAL deployment/infra integrations.
 *
 * Every provider is KEY-GATED. verify() makes a REAL, read-only API call to
 * confirm the token works and report what it can see (deployments/services/
 * projects). With no key a provider is honestly unavailable — never mocked.
 *
 * ACTUAL deploys are outward-facing side effects and are ALWAYS human-approval
 * gated by the engine; connectors here only READ (verify) and describe capability.
 *
 * Reuses the World Scanner FetchLike seam so tests inject a fake fetch.
 */

import type { FetchLike } from "../world-scanner/connectors";

export type ProviderName = "vercel" | "cloudflare" | "railway" | "render" | "docker" | "github" | "supabase" | "neon";
export type ProviderKind = "DEPLOY_HOST" | "DATABASE" | "REGISTRY" | "VCS";

export interface VerifyResult { ok: boolean; detail: string; account?: string }

export interface CloudProvider {
  name: ProviderName;
  kind: ProviderKind;
  keyEnv: string;
  note: string;
  available(): boolean;
  verify?(fetchImpl: FetchLike): Promise<VerifyResult>;
}

const UA = { "user-agent": "ShadowGenesisOS/1.0 (deploy)" };
const s = (v: unknown) => (typeof v === "string" ? v : "");

async function getJson(fetchImpl: FetchLike, url: string, key: string, scheme = "Bearer"): Promise<{ ok: boolean; status: number; data: unknown }> {
  const r = await fetchImpl(url, { headers: { ...UA, authorization: `${scheme} ${key}`, accept: "application/json" } });
  const data = r.ok ? await r.json().catch(() => ({})) : {};
  return { ok: r.ok, status: r.status, data };
}

export const vercel: CloudProvider = {
  name: "vercel", kind: "DEPLOY_HOST", keyEnv: "VERCEL_TOKEN", note: "set VERCEL_TOKEN — Next.js/static one-click host",
  available: () => !!process.env.VERCEL_TOKEN,
  async verify(fetchImpl) {
    const r = await getJson(fetchImpl, "https://api.vercel.com/v2/user", process.env.VERCEL_TOKEN!);
    if (!r.ok) return { ok: false, detail: `token rejected (HTTP ${r.status})` };
    const user = (r.data as { user?: { username?: string; email?: string } }).user;
    return { ok: true, detail: "token valid — deployments API reachable", account: s(user?.username) || s(user?.email) };
  },
};

export const cloudflare: CloudProvider = {
  name: "cloudflare", kind: "DEPLOY_HOST", keyEnv: "CLOUDFLARE_API_TOKEN", note: "set CLOUDFLARE_API_TOKEN — Pages/Workers host",
  available: () => !!process.env.CLOUDFLARE_API_TOKEN,
  async verify(fetchImpl) {
    const r = await getJson(fetchImpl, "https://api.cloudflare.com/client/v4/user/tokens/verify", process.env.CLOUDFLARE_API_TOKEN!);
    const ok = r.ok && (r.data as { success?: boolean }).success !== false;
    return { ok, detail: ok ? "token valid — Pages/Workers reachable" : `token rejected (HTTP ${r.status})` };
  },
};

export const railway: CloudProvider = {
  name: "railway", kind: "DEPLOY_HOST", keyEnv: "RAILWAY_TOKEN", note: "set RAILWAY_TOKEN — container/app host",
  available: () => !!process.env.RAILWAY_TOKEN,
  async verify(fetchImpl) {
    // Railway uses a GraphQL API; a minimal `me` query verifies the token.
    const r = await fetchImpl("https://backboard.railway.app/graphql/v2", { headers: { ...UA, authorization: `Bearer ${process.env.RAILWAY_TOKEN}`, "content-type": "application/json", "x-body": JSON.stringify({ query: "{ me { email } }" }) } });
    return { ok: r.ok, detail: r.ok ? "token valid — Railway API reachable" : `token rejected (HTTP ${r.status})` };
  },
};

export const render: CloudProvider = {
  name: "render", kind: "DEPLOY_HOST", keyEnv: "RENDER_API_KEY", note: "set RENDER_API_KEY — web-service host",
  available: () => !!process.env.RENDER_API_KEY,
  async verify(fetchImpl) {
    const r = await getJson(fetchImpl, "https://api.render.com/v1/services?limit=1", process.env.RENDER_API_KEY!);
    return { ok: r.ok, detail: r.ok ? "key valid — services API reachable" : `key rejected (HTTP ${r.status})` };
  },
};

export const github: CloudProvider = {
  name: "github", kind: "VCS", keyEnv: "GITHUB_TOKEN", note: "set GITHUB_TOKEN — source + Actions deploy trigger",
  available: () => !!process.env.GITHUB_TOKEN,
  async verify(fetchImpl) {
    const r = await getJson(fetchImpl, "https://api.github.com/user", process.env.GITHUB_TOKEN!);
    const login = (r.data as { login?: string }).login;
    return { ok: r.ok, detail: r.ok ? "token valid — repo/Actions reachable" : `token rejected (HTTP ${r.status})`, account: s(login) };
  },
};

export const supabase: CloudProvider = {
  name: "supabase", kind: "DATABASE", keyEnv: "SUPABASE_ACCESS_TOKEN", note: "set SUPABASE_ACCESS_TOKEN — managed Postgres + auth",
  available: () => !!process.env.SUPABASE_ACCESS_TOKEN,
  async verify(fetchImpl) {
    const r = await getJson(fetchImpl, "https://api.supabase.com/v1/projects", process.env.SUPABASE_ACCESS_TOKEN!);
    return { ok: r.ok, detail: r.ok ? "token valid — projects API reachable" : `token rejected (HTTP ${r.status})` };
  },
};

export const neon: CloudProvider = {
  name: "neon", kind: "DATABASE", keyEnv: "NEON_API_KEY", note: "set NEON_API_KEY — serverless Postgres",
  available: () => !!process.env.NEON_API_KEY,
  async verify(fetchImpl) {
    const r = await getJson(fetchImpl, "https://console.neon.tech/api/v2/projects", process.env.NEON_API_KEY!);
    return { ok: r.ok, detail: r.ok ? "key valid — projects API reachable" : `key rejected (HTTP ${r.status})` };
  },
};

/** Docker is a LOCAL CLI, not a keyed API — availability is checked by the engine
 *  via `docker version` (terminal tool), so it has no verify() here. */
export const docker: CloudProvider = {
  name: "docker", kind: "REGISTRY", keyEnv: "", note: "local Docker CLI — containerize + run; checked via `docker version`",
  available: () => true, // presence is verified at deploy time by the engine
};

export const CLOUD_PROVIDERS: CloudProvider[] = [vercel, cloudflare, railway, render, docker, github, supabase, neon];

export function cloudProviderHealth(): { name: ProviderName; kind: ProviderKind; available: boolean; note: string }[] {
  return CLOUD_PROVIDERS.map((p) => ({ name: p.name, kind: p.kind, available: p.available(), note: p.note }));
}
