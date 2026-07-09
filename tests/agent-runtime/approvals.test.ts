/** V8 G2 — Approval Control Center tests: risk scoring, blocking, single-use consumption, api-tool enforcement. */

import { test, expect, beforeEach } from "bun:test";
import { db } from "@/lib/db";
import { scoreRisk, requestApproval, decide, guardExternalAction, expireStale, isLocalHost } from "@/lib/genesis/agent-runtime/approvals";
import { apiTool } from "@/lib/genesis/agent-runtime/tools";
import type { ToolContext } from "@/lib/genesis/agent-runtime/tools";

const ctx: ToolContext = { executionId: "TEST-APR", agent: "TEST_APPROVALS", sandboxRoot: process.cwd() };

beforeEach(async () => {
  await db.approvalRequest.deleteMany({ where: { agent: "TEST_APPROVALS" } });
});

test("risk: payments outrank posts; amount and mass-contact raise risk transparently", () => {
  const payment = scoreRisk("PAYMENT", {});
  const post = scoreRisk("POST", {});
  expect(payment.riskScore).toBeGreaterThan(post.riskScore);
  const bigPayment = scoreRisk("PAYMENT", { amount: 5000 });
  expect(bigPayment.riskScore).toBeGreaterThan(payment.riskScore);
  expect(bigPayment.riskFactors.some((f) => f.includes("$5000"))).toBe(true);
  const massEmail = scoreRisk("EMAIL", { recipients: 500 });
  expect(massEmail.riskScore).toBeGreaterThan(scoreRisk("EMAIL", {}).riskScore);
  expect(massEmail.riskFactors.some((f) => f.includes("mass contact"))).toBe(true);
});

test("guard: without approval the action is blocked and a PENDING request is created", async () => {
  const gate = await guardExternalAction({ agent: "TEST_APPROVALS", actionType: "EMAIL", description: "send launch email" });
  expect(gate.allowed).toBe(false);
  expect(gate.requestId).toMatch(/^APR-\d{6}$/);
  const row = await db.approvalRequest.findUnique({ where: { requestId: gate.requestId } });
  expect(row!.status).toBe("PENDING");
});

test("guard: PENDING approvalId still blocks; REJECTED never admits", async () => {
  const req = await requestApproval({ agent: "TEST_APPROVALS", actionType: "POST", description: "post to forum" });
  const pending = await guardExternalAction({ agent: "TEST_APPROVALS", actionType: "POST", description: "post to forum", approvalId: req.requestId });
  expect(pending.allowed).toBe(false);
  await decide(req.requestId, { approve: false, decidedBy: "human@test" });
  const rejected = await guardExternalAction({ agent: "TEST_APPROVALS", actionType: "POST", description: "post to forum", approvalId: req.requestId });
  expect(rejected.allowed).toBe(false);
  expect(rejected.reason).toContain("REJECTED");
});

test("guard: APPROVED admits exactly once (single-use → EXECUTED)", async () => {
  const req = await requestApproval({ agent: "TEST_APPROVALS", actionType: "PAYMENT", description: "pay vendor", payload: { amount: 50 } });
  await decide(req.requestId, { approve: true, decidedBy: "human@test" });
  const first = await guardExternalAction({ agent: "TEST_APPROVALS", actionType: "PAYMENT", description: "pay vendor", approvalId: req.requestId });
  expect(first.allowed).toBe(true);
  const second = await guardExternalAction({ agent: "TEST_APPROVALS", actionType: "PAYMENT", description: "pay vendor", approvalId: req.requestId });
  expect(second.allowed).toBe(false); // already consumed
  const row = await db.approvalRequest.findUnique({ where: { requestId: req.requestId } });
  expect(row!.status).toBe("EXECUTED");
});

test("decide: cannot re-decide, and stale PENDING requests expire", async () => {
  const req = await requestApproval({ agent: "TEST_APPROVALS", actionType: "EMAIL", description: "x" });
  await decide(req.requestId, { approve: true, decidedBy: "human@test" });
  const again = await decide(req.requestId, { approve: false, decidedBy: "human@test" });
  expect(again.ok).toBe(false);
  // Expiry sweep
  const stale = await requestApproval({ agent: "TEST_APPROVALS", actionType: "EMAIL", description: "stale", ttlMs: -1000 });
  const expired = await expireStale();
  expect(expired).toBeGreaterThanOrEqual(1);
  const row = await db.approvalRequest.findUnique({ where: { requestId: stale.requestId } });
  expect(row!.status).toBe("EXPIRED");
});

test("api tool: external POST is blocked with APPROVAL_REQUIRED before any network call", async () => {
  const r = await apiTool.execute("request", { url: "https://external.example/webhook", method: "POST", body: "{}" }, ctx);
  expect(r.ok).toBe(false);
  expect(r.error).toBe("APPROVAL_REQUIRED");
  const requestId = (r.result as { requestId: string }).requestId;
  const row = await db.approvalRequest.findUnique({ where: { requestId } });
  expect(row!.actionType).toBe("HTTP_WRITE");
});

test("api tool: approved external POST passes the gate (fails only at network, not approval)", async () => {
  const blocked = await apiTool.execute("request", { url: "https://external.invalid/hook", method: "POST" }, ctx);
  const requestId = (blocked.result as { requestId: string }).requestId;
  await decide(requestId, { approve: true, decidedBy: "human@test" });
  const retried = await apiTool.execute("request", { url: "https://external.invalid/hook", method: "POST", approvalId: requestId }, ctx);
  expect(retried.error).not.toBe("APPROVAL_REQUIRED"); // gate passed; DNS failure is fine
});

test("api tool: GET and localhost writes stay free (research + local deploys unaffected)", async () => {
  expect(isLocalHost("localhost")).toBe(true);
  const get = await apiTool.execute("request", { url: "https://external.invalid/page", method: "GET" }, ctx);
  expect(get.error).not.toBe("APPROVAL_REQUIRED");
  const local = await apiTool.execute("request", { url: "http://127.0.0.1:59999/x", method: "POST" }, ctx);
  expect(local.error).not.toBe("APPROVAL_REQUIRED");
});
