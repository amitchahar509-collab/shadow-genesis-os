/** V8 G10 — SaaS auth tests: keys, roles, enforcement, audit, and a gated route end to end. */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { db } from "@/lib/db";
import { bootstrap, authenticate, guard, createApiKey, audit, isProvisioned, LOCAL_PRINCIPAL } from "@/lib/genesis/agent-runtime/auth";
import { PATCH as approvalsPatch } from "@/app/api/genesis/approvals/route";
import { requestApproval } from "@/lib/genesis/agent-runtime/approvals";

async function wipeAuth() {
  await db.apiKey.deleteMany({});
  await db.membership.deleteMany({});
  await db.auditLog.deleteMany({});
  await db.authUser.deleteMany({});
  await db.organization.deleteMany({});
}

beforeEach(wipeAuth);
afterEach(() => { delete process.env.GENESIS_AUTH_REQUIRED; });

test("bootstrap provisions owner + org + OWNER key, and refuses a second time", async () => {
  expect(await isProvisioned()).toBe(false);
  const b = await bootstrap({ email: "owner@test.dev", orgName: "Test Co" });
  expect(b.userId).toMatch(/^U-\d{6}$/);
  expect(b.orgId).toMatch(/^ORG-\d{6}$/);
  expect(b.apiKey).toMatch(/^gk_[a-f0-9]{48}$/);
  expect(await isProvisioned()).toBe(true);
  await expect(bootstrap({ email: "other@test.dev" })).rejects.toThrow(/already provisioned/);
});

test("authenticate: valid key → OWNER principal; garbage and revoked → null", async () => {
  const b = await bootstrap({ email: "o@test.dev" });
  const p = await authenticate(b.apiKey);
  expect(p?.role).toBe("OWNER");
  expect(p?.userId).toBe(b.userId);
  expect(await authenticate("gk_not_a_real_key")).toBeNull();
  expect(await authenticate(null)).toBeNull();
  // revoke it
  await db.apiKey.updateMany({ where: { userId: b.userId }, data: { revokedAt: new Date() } });
  expect(await authenticate(b.apiKey)).toBeNull();
});

test("guard local mode (default): missing key is allowed as LOCAL, key still honoured", async () => {
  const g = await guard(null, "ADMIN");
  expect(g.ok).toBe(true);
  if (g.ok) expect(g.principal.local).toBe(true);
  const b = await bootstrap({ email: "o@test.dev" });
  const g2 = await guard(`Bearer ${b.apiKey}`, "ADMIN");
  expect(g2.ok).toBe(true);
  if (g2.ok) expect(g2.principal.role).toBe("OWNER");
});

test("guard enforced mode: no key → 401, insufficient role → 403, sufficient → ok", async () => {
  process.env.GENESIS_AUTH_REQUIRED = "1";
  const b = await bootstrap({ email: "o@test.dev" });
  const viewer = await createApiKey({ userId: b.userId, orgId: b.orgId, role: "VIEWER", label: "v" });

  const noKey = await guard(null, "MEMBER");
  expect(noKey.ok).toBe(false);
  if (!noKey.ok) expect(noKey.status).toBe(401);

  const lowRole = await guard(`Bearer ${viewer.apiKey}`, "ADMIN");
  expect(lowRole.ok).toBe(false);
  if (!lowRole.ok) expect(lowRole.status).toBe(403);

  const ok = await guard(`Bearer ${b.apiKey}`, "ADMIN");
  expect(ok.ok).toBe(true);
});

test("audit writes a row with the actor identity", async () => {
  const b = await bootstrap({ email: "o@test.dev" });
  const p = await authenticate(b.apiKey);
  await audit(p!, "TEST_ACTION", "target-1", "did a thing");
  const row = await db.auditLog.findFirst({ where: { action: "TEST_ACTION" } });
  expect(row!.actor).toBe(b.userId);
  await audit(LOCAL_PRINCIPAL, "LOCAL_ACTION");
  const local = await db.auditLog.findFirst({ where: { action: "LOCAL_ACTION" } });
  expect(local!.actor).toBe("local");
});

test("gated route (approvals PATCH): 401 without a key when enforced, 200 with an ADMIN key", async () => {
  process.env.GENESIS_AUTH_REQUIRED = "1";
  const b = await bootstrap({ email: "o@test.dev" });
  const apr = await requestApproval({ agent: "TEST_AUTH", actionType: "EMAIL", description: "auth-gated decision" });

  const unauth = await approvalsPatch(new Request("http://localhost/api/genesis/approvals", {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: apr.requestId, approve: true, decidedBy: "x" }),
  }) as never);
  expect(unauth.status).toBe(401);

  const authed = await approvalsPatch(new Request("http://localhost/api/genesis/approvals", {
    method: "PATCH", headers: { "content-type": "application/json", authorization: `Bearer ${b.apiKey}` },
    body: JSON.stringify({ requestId: apr.requestId, approve: true, decidedBy: "owner@test.dev" }),
  }) as never);
  expect(authed.status).toBe(200);
  const decided = await db.approvalRequest.findUnique({ where: { requestId: apr.requestId } });
  expect(decided!.status).toBe("APPROVED");
  // the decision was audited
  const al = await db.auditLog.findFirst({ where: { action: "APPROVAL_DECIDE", target: apr.requestId } });
  expect(al).not.toBeNull();
  await db.approvalRequest.deleteMany({ where: { agent: "TEST_AUTH" } });
});
