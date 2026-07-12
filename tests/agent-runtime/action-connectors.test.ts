/** V10 Module 10 — Real Action Connectors. Every external mutation is approval-
 *  gated, idempotent, retried, delivery-verified, and company-scoped. Unconfigured
 *  connectors NEVER run; deliveries are verified from real responses — never faked.
 *  Network-free via an injected fetch seam. */

import { test, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { db } from "@/lib/db";
import {
  connectorHealth, verifyConnector, requestAction, decideAction, executeAction,
  retryAction, deadLetterQueue, connectorCatalog,
} from "@/lib/genesis/agent-runtime/action-connectors";
import type { FetchLike } from "@/lib/genesis/agent-runtime/world-scanner/connectors";

const CREDS = ["GITHUB_TOKEN", "SLACK_BOT_TOKEN", "DISCORD_WEBHOOK_URL", "NOTION_API_KEY", "LINEAR_API_KEY", "HUBSPOT_ACCESS_TOKEN", "GOOGLE_ACCESS_TOKEN"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of CREDS) saved[k] = process.env[k];

// seams
const ghOk: FetchLike = async (url) => url.includes("/issues")
  ? { ok: true, status: 201, json: async () => ({ number: 42, html_url: "https://github.com/x/y/issues/42" }), text: async () => "" }
  : { ok: true, status: 200, json: async () => ({ login: "acme-bot" }), text: async () => "" };
const ghRateThenOk = () => { let n = 0; const f: FetchLike = async (url) => { if (url.includes("/issues")) { n++; if (n < 3) return { ok: false, status: 503, json: async () => ({}), text: async () => "" }; return { ok: true, status: 201, json: async () => ({ number: 7, html_url: "u" }), text: async () => "" }; } return { ok: true, status: 200, json: async () => ({ login: "x" }), text: async () => "" }; }; return f; };
const ghAlways503: FetchLike = async (url) => url.includes("/issues") ? { ok: false, status: 503, json: async () => ({}), text: async () => "" } : { ok: true, status: 200, json: async () => ({ login: "x" }), text: async () => "" };
const ghHard400: FetchLike = async (url) => url.includes("/issues") ? { ok: false, status: 400, json: async () => ({ message: "bad" }), text: async () => "" } : { ok: true, status: 200, json: async () => ({ login: "x" }), text: async () => "" };

async function wipe() {
  await db.connectorAction.deleteMany({ where: { OR: [{ agent: "ACTTEST" }, { companyKey: { startsWith: "ACTTEST" } }] } });
  await db.approvalRequest.deleteMany({ where: { agent: "ACTTEST" } });
}
beforeEach(async () => { for (const k of CREDS) delete process.env[k]; await wipe(); });
afterEach(() => { for (const k of CREDS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
afterAll(wipe);

async function stage(payloadOverrides: Record<string, unknown> = {}, company = "ACTTEST_co") {
  return requestAction({ connector: "github", operation: "create_issue", companyKey: company, agent: "ACTTEST", payload: { repo: "acme/app", title: "bug: export fails", body: "details", ...payloadOverrides } });
}

test("catalog lists 14 connectors; unconfigured by default (no fabricated connection)", () => {
  const cat = connectorCatalog();
  expect(cat.length).toBeGreaterThanOrEqual(14);
  expect(cat.find((c) => c.name === "github")!.available).toBe(false); // no token
  expect(connectorHealth().find((c) => c.name === "github")!.status).toBe("UNCONFIGURED");
});

test("verify is KEY-GATED — UNCONFIGURED without creds, CONNECTED with a valid token", async () => {
  const u = await verifyConnector("github", { fetchImpl: ghOk });
  expect(u.status).toBe("UNCONFIGURED");
  process.env.GITHUB_TOKEN = "ghp_test";
  const c = await verifyConnector("github", { fetchImpl: ghOk });
  expect(c.status).toBe("CONNECTED");
  expect(c.account).toBe("acme-bot");
});

test("requestAction on an UNCONFIGURED connector is refused (never staged)", async () => {
  const r = await stage();
  expect("error" in r).toBe(true);
  if ("error" in r) expect(r.error).toContain("UNCONFIGURED");
});

test("missing required fields are rejected before any approval", async () => {
  process.env.GITHUB_TOKEN = "ghp_test";
  const r = await requestAction({ connector: "github", operation: "create_issue", agent: "ACTTEST", payload: { repo: "acme/app" } }); // no title
  expect("error" in r).toBe(true);
  if ("error" in r) expect(r.error).toContain("title");
});

test("APPROVAL GATE: cannot execute without approval; approve → real delivery verified", async () => {
  process.env.GITHUB_TOKEN = "ghp_test";
  const staged = await stage() as { actionId: string; approvalId: string; status: string };
  expect(staged.status).toBe("PENDING_APPROVAL");
  expect(staged.approvalId).toMatch(/^APR-/);

  // execute before approval → refused
  const early = await executeAction(staged.actionId, { fetchImpl: ghOk });
  expect(early.ok).toBe(false);
  expect(early.error).toContain("not APPROVED");

  await decideAction(staged.actionId, { approve: true, decidedBy: "operator" });
  const exec = await executeAction(staged.actionId, { fetchImpl: ghOk });
  expect(exec.ok).toBe(true);
  expect(exec.status).toBe("DELIVERED");
  expect(exec.deliveryVerified).toBe(true);
  expect(exec.externalId).toBe("#42"); // real provider id = delivery proof
});

test("approval is single-use — a delivered action cannot be re-executed", async () => {
  process.env.GITHUB_TOKEN = "ghp_test";
  const staged = await stage() as { actionId: string };
  await decideAction(staged.actionId, { approve: true, decidedBy: "op" });
  await executeAction(staged.actionId, { fetchImpl: ghOk });
  const again = await executeAction(staged.actionId, { fetchImpl: ghOk });
  expect(again.ok).toBe(false); // status is DELIVERED, not APPROVED
});

test("rejected action never executes", async () => {
  process.env.GITHUB_TOKEN = "ghp_test";
  const staged = await stage() as { actionId: string };
  await decideAction(staged.actionId, { approve: false, decidedBy: "op", note: "wrong repo" });
  const exec = await executeAction(staged.actionId, { fetchImpl: ghOk });
  expect(exec.ok).toBe(false);
  expect((await db.connectorAction.findUnique({ where: { actionId: staged.actionId } }))!.status).toBe("REJECTED");
});

test("retry on transient errors then succeeds (delivery verified)", async () => {
  process.env.GITHUB_TOKEN = "ghp_test";
  const staged = await stage() as { actionId: string };
  await decideAction(staged.actionId, { approve: true, decidedBy: "op" });
  const exec = await executeAction(staged.actionId, { fetchImpl: ghRateThenOk() });
  expect(exec.ok).toBe(true);
  expect(exec.attempts).toBe(3); // failed twice (503), delivered on the 3rd
});

test("exhausted transient retries → DEAD_LETTER; retryAction can re-deliver", async () => {
  process.env.GITHUB_TOKEN = "ghp_test";
  const staged = await stage() as { actionId: string };
  await decideAction(staged.actionId, { approve: true, decidedBy: "op" });
  const exec = await executeAction(staged.actionId, { fetchImpl: ghAlways503 });
  expect(exec.status).toBe("DEAD_LETTER");
  const dlq = await deadLetterQueue();
  expect(dlq.some((a) => a.actionId === staged.actionId)).toBe(true);
  // retry with a now-healthy transport delivers (no re-approval needed)
  const retry = await retryAction(staged.actionId, { fetchImpl: ghOk });
  expect(retry.ok).toBe(true);
  expect(retry.status).toBe("DELIVERED");
});

test("hard (non-transient) error fails WITHOUT retry", async () => {
  process.env.GITHUB_TOKEN = "ghp_test";
  const staged = await stage() as { actionId: string };
  await decideAction(staged.actionId, { approve: true, decidedBy: "op" });
  const exec = await executeAction(staged.actionId, { fetchImpl: ghHard400 });
  expect(exec.ok).toBe(false);
  expect(exec.status).toBe("FAILED");
  expect(exec.attempts).toBe(1); // 400 is not retried
});

test("idempotency: same key never stages twice", async () => {
  process.env.GITHUB_TOKEN = "ghp_test";
  const a = await stage({}, "ACTTEST_co") as { actionId: string };
  const b = await requestAction({ connector: "github", operation: "create_issue", companyKey: "ACTTEST_co", agent: "ACTTEST", payload: { repo: "acme/app", title: "bug: export fails" }, idempotencyKey: "dedupe-1" });
  const c = await requestAction({ connector: "github", operation: "create_issue", companyKey: "ACTTEST_co", agent: "ACTTEST", payload: { repo: "acme/app", title: "again" }, idempotencyKey: "dedupe-1" });
  expect((b as { actionId: string }).actionId).toBe((c as { actionId: string }).actionId); // same key → same action
  expect((a as { actionId: string }).actionId).not.toBe((b as { actionId: string }).actionId);
});

test("multi-company isolation: an action carries its companyKey and stays scoped", async () => {
  process.env.GITHUB_TOKEN = "ghp_test";
  const coA = await stage({}, "ACTTEST_coA") as { actionId: string };
  const coB = await stage({}, "ACTTEST_coB") as { actionId: string };
  const rowA = await db.connectorAction.findUnique({ where: { actionId: coA.actionId } });
  const rowB = await db.connectorAction.findUnique({ where: { actionId: coB.actionId } });
  expect(rowA!.companyKey).toBe("ACTTEST_coA");
  expect(rowB!.companyKey).toBe("ACTTEST_coB");
  expect(rowA!.approvalId).not.toBe(rowB!.approvalId); // separate approvals, no shared authorization
});

test("credentials are NEVER persisted in the ledger (redacted)", async () => {
  process.env.GITHUB_TOKEN = "ghp_test";
  const staged = await requestAction({ connector: "github", operation: "create_issue", agent: "ACTTEST", payload: { repo: "acme/app", title: "leak sk-ant-api03-abcdefghij1234567890KLMNOP" } }) as { actionId: string };
  const row = await db.connectorAction.findUnique({ where: { actionId: staged.actionId } });
  expect(row!.payload).not.toContain("sk-ant-api03-abcdefghij1234567890KLMNOP");
  expect(row!.payload).toContain("[REDACTED");
});

test("test-env network lockout: execute without a seam touches no network", async () => {
  process.env.GITHUB_TOKEN = "ghp_test";
  const staged = await stage() as { actionId: string };
  await decideAction(staged.actionId, { approve: true, decidedBy: "op" });
  const exec = await executeAction(staged.actionId); // no fetchImpl
  expect(exec.ok).toBe(false);
  expect(exec.error).toContain("NETWORK_DISABLED_IN_TESTS");
});
