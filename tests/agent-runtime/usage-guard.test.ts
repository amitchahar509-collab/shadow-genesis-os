/** Cycle 23 — guard rollout + per-org usage limits: metering, and a rolled-out route enforcing. */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { db } from "@/lib/db";
import { checkAndRecordUsage, bootstrap, authenticate, LOCAL_PRINCIPAL, type Principal } from "@/lib/genesis/agent-runtime/auth";
import { POST as aegisPost } from "@/app/api/genesis/aegis/route";

const savedReq = process.env.GENESIS_AUTH_REQUIRED;
const savedLimit = process.env.GENESIS_ORG_DAILY_LIMIT;
const TEST_ORG = "ORG-USAGETEST";

async function wipe() {
  await db.usageCounter.deleteMany({ where: { orgId: TEST_ORG } });
  await db.apiKey.deleteMany({}); await db.membership.deleteMany({}); await db.authUser.deleteMany({}); await db.organization.deleteMany({});
  await db.usageCounter.deleteMany({});
}
beforeEach(wipe);
afterEach(() => {
  if (savedReq === undefined) delete process.env.GENESIS_AUTH_REQUIRED; else process.env.GENESIS_AUTH_REQUIRED = savedReq;
  if (savedLimit === undefined) delete process.env.GENESIS_ORG_DAILY_LIMIT; else process.env.GENESIS_ORG_DAILY_LIMIT = savedLimit;
});

test("local principal is unmetered (single-operator dashboard never hits a quota)", async () => {
  const u = await checkAndRecordUsage(LOCAL_PRINCIPAL);
  expect(u.ok).toBe(true);
  expect(u.remaining).toBeGreaterThan(1_000_000);
  const rows = await db.usageCounter.count();
  expect(rows).toBe(0); // no counter written for local
});

test("org principal is metered and 429s past the daily limit", async () => {
  process.env.GENESIS_ORG_DAILY_LIMIT = "2";
  const p: Principal = { userId: "U-x", orgId: TEST_ORG, role: "MEMBER", keyId: "AK-x" };
  const a = await checkAndRecordUsage(p); expect(a.ok).toBe(true); expect(a.remaining).toBe(1);
  const b = await checkAndRecordUsage(p); expect(b.ok).toBe(true); expect(b.remaining).toBe(0);
  const c = await checkAndRecordUsage(p); expect(c.ok).toBe(false); expect(c.limit).toBe(2); // over cap → denied
});

test("rolled-out route (aegis POST) 401s without a key when enforced, 200 with a MEMBER key", async () => {
  process.env.GENESIS_AUTH_REQUIRED = "1";
  const b = await bootstrap({ email: "u@test.dev" }); // OWNER key (>= MEMBER)

  const noKey = await aegisPost(new Request("http://localhost/api/genesis/aegis", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ statement: "usage-guard test claim", evidence: [] }),
  }) as never);
  expect(noKey.status).toBe(401);

  const authed = await aegisPost(new Request("http://localhost/api/genesis/aegis", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${b.apiKey}` },
    body: JSON.stringify({ statement: "usage-guard test claim", evidence: [] }),
  }) as never);
  expect(authed.status).toBe(200);
  // usage was metered for the org
  const counter = await db.usageCounter.findFirst({ where: { orgId: b.orgId } });
  expect(counter!.count).toBeGreaterThanOrEqual(1);
  await db.claim.deleteMany({ where: { statement: "usage-guard test claim" } });
});

test("local mode (unenforced): rolled-out route still works without a key (dashboard unaffected)", async () => {
  delete process.env.GENESIS_AUTH_REQUIRED;
  const r = await aegisPost(new Request("http://localhost/api/genesis/aegis", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ statement: "usage-guard local claim", evidence: [] }),
  }) as never);
  expect(r.status).toBe(200); // local principal admitted, unmetered
  await db.claim.deleteMany({ where: { statement: "usage-guard local claim" } });
});
