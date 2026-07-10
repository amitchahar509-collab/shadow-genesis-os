/** SaaS Foundation (V8 G10) — authentication, orgs, roles, audit.
 *
 * The top production blocker was that every /api/genesis/* route was open. This
 * layer provides real, hashed API-key auth with an org/role model and an audit
 * trail, applied to the human-authority and write endpoints.
 *
 * Enforcement is local-first and honest:
 *   - GENESIS_AUTH_REQUIRED=1  → protected routes REQUIRE a valid key
 *     (401 without, 403 for insufficient role). This is the production setting.
 *   - unset (default)          → protected routes run in LOCAL mode so the
 *     single-operator dashboard keeps working; a supplied key is still honoured
 *     for the audit principal, and every action is audited as actor "local".
 *
 * Keys are shown in plaintext exactly once (at creation); only the sha256 hash
 * is stored. Never log or return the secret again.
 */

import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { emit } from "../event-bus";

export type Role = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
const RANK: Record<Role, number> = { VIEWER: 1, MEMBER: 2, ADMIN: 3, OWNER: 4 };

export interface Principal { userId: string; orgId: string; role: Role; keyId: string; local?: boolean }
export const LOCAL_PRINCIPAL: Principal = { userId: "local", orgId: "local", role: "OWNER", keyId: "local", local: true };

export interface GuardOk { ok: true; principal: Principal }
export interface GuardErr { ok: false; status: 401 | 403; error: string }

function sha256(s: string): string { return createHash("sha256").update(s).digest("hex"); }
function enforced(): boolean { return process.env.GENESIS_AUTH_REQUIRED === "1"; }

/** Pull "Bearer gk_…" from an Authorization header value. */
export function parseBearer(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(gk_[A-Za-z0-9]+)$/);
  return m ? m[1] : null;
}

/** Resolve a principal from a raw API key, or null if invalid/revoked. Touches lastUsedAt. */
export async function authenticate(rawKey: string | null): Promise<Principal | null> {
  if (!rawKey) return null;
  const key = await db.apiKey.findUnique({ where: { hash: sha256(rawKey) } });
  if (!key || key.revokedAt) return null;
  await db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return { userId: key.userId, orgId: key.orgId, role: key.role as Role, keyId: key.keyId };
}

/**
 * Gate a route. Returns the principal to use, or an error to return verbatim.
 * In LOCAL mode (default) an absent key yields LOCAL_PRINCIPAL rather than 401.
 */
export async function guard(authHeader: string | null | undefined, minRole: Role = "MEMBER"): Promise<GuardOk | GuardErr> {
  const principal = await authenticate(parseBearer(authHeader));
  if (!principal) {
    if (enforced()) return { ok: false, status: 401, error: "authentication required: provide 'Authorization: Bearer gk_…'" };
    return { ok: true, principal: LOCAL_PRINCIPAL }; // local-first: open, audited as "local"
  }
  if (RANK[principal.role] < RANK[minRole]) return { ok: false, status: 403, error: `role ${principal.role} insufficient (need ${minRole})` };
  return { ok: true, principal };
}

async function nextId(model: "user" | "org" | "key" | "audit", prefix: string): Promise<string> {
  const pick = { user: () => db.authUser.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { userId: true } }),
    org: () => db.organization.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { orgId: true } }),
    key: () => db.apiKey.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { keyId: true } }),
    audit: () => db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { auditId: true } }) }[model];
  const rows = await pick();
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const r of rows as Record<string, string>[]) { const id = Object.values(r)[0]; const m = id.match(re); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `${prefix}-${(max + 1).toString().padStart(6, "0")}`;
}

/** Mint a key. Returns the plaintext ONCE — the caller must show it and forget it. */
export async function createApiKey(input: { userId: string; orgId: string; role: Role; label?: string }): Promise<{ keyId: string; apiKey: string; role: Role }> {
  const secret = `gk_${randomBytes(24).toString("hex")}`;
  const keyId = await nextId("key", "AK");
  await db.apiKey.create({ data: { keyId, prefix: secret.slice(0, 11), hash: sha256(secret), label: input.label ?? "default", userId: input.userId, orgId: input.orgId, role: input.role } });
  return { keyId, apiKey: secret, role: input.role };
}

/** First-run provisioning: create the owner, their org, and an OWNER key. Refuses if already provisioned. */
export async function bootstrap(input: { email: string; name?: string; orgName?: string }): Promise<{ userId: string; orgId: string; apiKey: string }> {
  if ((await db.authUser.count()) > 0) throw new Error("already provisioned: users exist");
  const userId = await nextId("user", "U");
  const orgId = await nextId("org", "ORG");
  const slug = (input.orgName ?? input.email.split("@")[0]).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "org";
  await db.authUser.create({ data: { userId, email: input.email, name: input.name ?? null } });
  await db.organization.create({ data: { orgId, name: input.orgName ?? `${input.email}'s org`, slug: `${slug}-${orgId.toLowerCase()}` } });
  await db.membership.create({ data: { userId, orgId, role: "OWNER" } });
  const { apiKey } = await createApiKey({ userId, orgId, role: "OWNER", label: "bootstrap" });
  await audit({ userId, orgId, role: "OWNER", keyId: "bootstrap" }, "BOOTSTRAP", orgId, `owner ${input.email}`);
  return { userId, orgId, apiKey };
}

export async function audit(principal: Principal, action: string, target?: string, detail = ""): Promise<void> {
  const auditId = await nextId("audit", "AL");
  await db.auditLog.create({ data: { auditId, actor: principal.local ? "local" : principal.userId, orgId: principal.local ? null : principal.orgId, role: principal.role, action, target: target ?? null, detail: detail.slice(0, 500) } }).catch(() => {});
}

export async function isProvisioned(): Promise<boolean> { return (await db.authUser.count()) > 0; }

/**
 * Per-org daily mutation quota. The local/single-operator principal is
 * unlimited; a real org key is metered against a daily cap (env
 * GENESIS_ORG_DAILY_LIMIT, default 2000, or a per-row override). Returns the
 * remaining budget, or ok:false at 429 when the cap is exceeded.
 */
export async function checkAndRecordUsage(principal: Principal): Promise<{ ok: boolean; remaining: number; limit: number; error?: string }> {
  if (principal.local) return { ok: true, remaining: Number.MAX_SAFE_INTEGER, limit: 0 }; // local operator: unmetered
  const day = new Date().toISOString().slice(0, 10);
  const defaultLimit = Number(process.env.GENESIS_ORG_DAILY_LIMIT) || 2000;
  const row = await db.usageCounter.upsert({
    where: { orgId_day: { orgId: principal.orgId, day } },
    create: { orgId: principal.orgId, day, count: 1, limit: defaultLimit },
    update: { count: { increment: 1 } },
  });
  if (row.count > row.limit) {
    await emit({ agent: "AUTH", action: "USAGE_LIMIT", detail: `${principal.orgId} exceeded daily limit ${row.limit}`, level: "WARNING", category: "SECURITY" });
    return { ok: false, remaining: 0, limit: row.limit, error: `daily usage limit reached (${row.limit}/day for this org)` };
  }
  return { ok: true, remaining: row.limit - row.count, limit: row.limit };
}
