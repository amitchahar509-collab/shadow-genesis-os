/** Approval Control Center (V8 G2) — human remains CEO.
 *
 * Any real-world action (email, post, payment, purchase, account action,
 * customer contact, outbound HTTP write) must pass through this queue:
 *
 *   agent calls guardExternalAction()
 *     → no approval yet: an ApprovalRequest (PENDING, risk-scored) is created
 *       and the action is BLOCKED — the agent reports APPROVAL_REQUIRED.
 *     → a human decides via /api/genesis/approvals (APPROVED / REJECTED).
 *     → the agent retries with approvalId; an APPROVED request admits exactly
 *       one execution (marked EXECUTED — single-use), REJECTED never admits.
 *
 * Risk scoring is rule-based and transparent (riskFactors lists every reason).
 * Pending requests expire after 24h so stale approvals can't fire later.
 */

import { db } from "@/lib/db";
import { emit } from "../event-bus";

export type ActionType = "EMAIL" | "POST" | "PAYMENT" | "PURCHASE" | "ACCOUNT" | "CUSTOMER_CONTACT" | "HTTP_WRITE" | "OTHER";
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXECUTED" | "EXPIRED";

const BASE_RISK: Record<ActionType, number> = {
  PAYMENT: 80, PURCHASE: 75, ACCOUNT: 65, EMAIL: 50, CUSTOMER_CONTACT: 55, POST: 45, HTTP_WRITE: 40, OTHER: 50,
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Transparent rule-based risk: base by action type + payload signals. */
export function scoreRisk(actionType: ActionType, payload: Record<string, unknown> = {}): { riskScore: number; riskFactors: string[] } {
  let risk = BASE_RISK[actionType] ?? 50;
  const factors = [`base risk for ${actionType}: ${BASE_RISK[actionType] ?? 50}`];

  const amount = typeof payload.amount === "number" ? payload.amount : undefined;
  if (amount !== undefined) {
    const bump = amount >= 1000 ? 20 : amount >= 100 ? 10 : amount >= 10 ? 5 : 0;
    if (bump) { risk += bump; factors.push(`monetary amount $${amount} (+${bump})`); }
  }
  const recipients = Array.isArray(payload.recipients) ? payload.recipients.length : typeof payload.recipients === "number" ? payload.recipients : undefined;
  if (recipients !== undefined && recipients > 1) {
    const bump = recipients >= 100 ? 25 : recipients >= 10 ? 15 : 5;
    risk += bump; factors.push(`${recipients} recipients (+${bump}) — mass contact`);
  }
  if (typeof payload.url === "string") {
    try {
      const host = new URL(payload.url).hostname;
      if (!isLocalHost(host)) { risk += 5; factors.push(`external host ${host} (+5)`); }
    } catch { risk += 10; factors.push("unparseable url (+10)"); }
  }
  if (payload.irreversible === true) { risk += 15; factors.push("marked irreversible (+15)"); }

  return { riskScore: clamp(risk), riskFactors: factors };
}

export function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "0.0.0.0";
}

async function nextRequestNumber(): Promise<number> {
  const rows = await db.approvalRequest.findMany({ orderBy: { requestedAt: "desc" }, take: 50, select: { requestId: true } });
  let max = 0;
  for (const r of rows) { const m = r.requestId.match(/^APR-(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return max + 1;
}

export interface ApprovalInfo {
  requestId: string; status: ApprovalStatus; actionType: ActionType; riskScore: number; riskFactors: string[]; description: string;
}

/** Create a PENDING approval request. The caller must stop and report it. */
export async function requestApproval(input: { agent: string; actionType: ActionType; description: string; payload?: Record<string, unknown>; executionId?: string; ttlMs?: number }): Promise<ApprovalInfo> {
  const { riskScore, riskFactors } = scoreRisk(input.actionType, input.payload ?? {});
  const requestId = `APR-${(await nextRequestNumber()).toString().padStart(6, "0")}`;
  await db.approvalRequest.create({
    data: {
      requestId, agent: input.agent, executionId: input.executionId ?? null, actionType: input.actionType,
      description: input.description.slice(0, 500), payload: safeJson(input.payload ?? {}),
      riskScore, riskFactors: JSON.stringify(riskFactors), status: "PENDING",
      expiresAt: new Date(Date.now() + (input.ttlMs ?? DEFAULT_TTL_MS)),
    },
  });
  await emit({ agent: input.agent, action: "APPROVAL_REQUESTED", detail: `${requestId} [risk ${riskScore}] ${input.actionType}: ${input.description.slice(0, 100)}`, level: riskScore >= 70 ? "WARNING" : "INFO", category: "SECURITY" });
  return { requestId, status: "PENDING", actionType: input.actionType, riskScore, riskFactors, description: input.description };
}

/** Human decision. Only PENDING (unexpired) requests can be decided. */
export async function decide(requestId: string, opts: { approve: boolean; decidedBy: string; note?: string }): Promise<{ ok: boolean; status?: ApprovalStatus; error?: string }> {
  const row = await db.approvalRequest.findUnique({ where: { requestId } });
  if (!row) return { ok: false, error: "not found" };
  if (row.status !== "PENDING") return { ok: false, error: `cannot decide a ${row.status} request` };
  if (row.expiresAt && row.expiresAt < new Date()) {
    await db.approvalRequest.update({ where: { requestId }, data: { status: "EXPIRED" } });
    return { ok: false, error: "request expired" };
  }
  const status: ApprovalStatus = opts.approve ? "APPROVED" : "REJECTED";
  await db.approvalRequest.update({ where: { requestId }, data: { status, decidedBy: opts.decidedBy, decisionNote: opts.note ?? null, decidedAt: new Date() } });
  await emit({ agent: "HUMAN", action: `APPROVAL_${status}`, detail: `${requestId} ${status} by ${opts.decidedBy}${opts.note ? `: ${opts.note.slice(0, 80)}` : ""}`, level: opts.approve ? "SUCCESS" : "WARNING", category: "SECURITY" });
  return { ok: true, status };
}

/**
 * Gate an external action. Without an approvalId (or with one that isn't
 * APPROVED) the action is denied. An APPROVED request admits exactly once.
 */
export async function guardExternalAction(input: { agent: string; actionType: ActionType; description: string; payload?: Record<string, unknown>; executionId?: string; approvalId?: string }): Promise<{ allowed: boolean; requestId: string; riskScore?: number; reason: string }> {
  if (input.approvalId) {
    const row = await db.approvalRequest.findUnique({ where: { requestId: input.approvalId } });
    if (!row) return { allowed: false, requestId: input.approvalId, reason: "approval not found" };
    if (row.expiresAt && row.expiresAt < new Date() && row.status === "PENDING") {
      await db.approvalRequest.update({ where: { requestId: row.requestId }, data: { status: "EXPIRED" } });
      return { allowed: false, requestId: row.requestId, reason: "approval expired" };
    }
    if (row.status !== "APPROVED") return { allowed: false, requestId: row.requestId, reason: `approval is ${row.status}, not APPROVED` };
    // Single-use: atomically flip APPROVED → EXECUTED so a race can't double-fire.
    const { count } = await db.approvalRequest.updateMany({ where: { requestId: row.requestId, status: "APPROVED" }, data: { status: "EXECUTED", executedAt: new Date() } });
    if (count === 0) return { allowed: false, requestId: row.requestId, reason: "approval already consumed" };
    await emit({ agent: input.agent, action: "APPROVAL_CONSUMED", detail: `${row.requestId} executed: ${input.description.slice(0, 100)}`, level: "SUCCESS", category: "SECURITY" });
    return { allowed: true, requestId: row.requestId, reason: "approved" };
  }
  const req = await requestApproval(input);
  return { allowed: false, requestId: req.requestId, riskScore: req.riskScore, reason: "APPROVAL_REQUIRED: human approval pending" };
}

/** Sweep stale PENDING requests → EXPIRED. Returns how many were expired. */
export async function expireStale(): Promise<number> {
  const { count } = await db.approvalRequest.updateMany({ where: { status: "PENDING", expiresAt: { lt: new Date() } }, data: { status: "EXPIRED" } });
  return count;
}

function safeJson(v: unknown): string { try { const s = JSON.stringify(v); return s.length > 20_000 ? s.slice(0, 20_000) : s; } catch { return "{}"; } }
