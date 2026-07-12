/** V10 Module 9 — Company OS. A per-company operating view that AGGREGATES the
 *  real per-module tables by companyKey. No parallel stores, no fabricated data —
 *  empty sections are honestly empty. Network-free. */

import { test, expect, beforeEach, afterAll } from "bun:test";
import { db } from "@/lib/db";
import { ensureCompany, companyWorkspace, companyHealth, companyOverview } from "@/lib/genesis/agent-runtime/company-os";
import { recordProductEvent, createTicket } from "@/lib/genesis/agent-runtime/customer-success";
import { recordRevenueEvent } from "@/lib/genesis/agent-runtime/revenue-engine";

const KEY = "COTEST_acme";

async function wipe() {
  await db.lead.deleteMany({ where: { subject: KEY } });
  await db.productEvent.deleteMany({ where: { productKey: KEY } });
  const tickets = await db.supportTicket.findMany({ where: { productKey: KEY }, select: { taskId: true, signalId: true } });
  await db.supportTicket.deleteMany({ where: { productKey: KEY } });
  for (const t of tickets) { if (t.taskId) await db.genesisTask.deleteMany({ where: { taskId: t.taskId } }); if (t.signalId) await db.realitySignal.deleteMany({ where: { signalId: t.signalId } }); }
  await db.revenueEvent.deleteMany({ where: { projectId: KEY } });
  await db.realitySignal.deleteMany({ where: { productKey: KEY } });
  await db.company.deleteMany({ where: { key: KEY } });
}
beforeEach(wipe);
afterAll(wipe);

test("ensureCompany creates a workspace, is idempotent", async () => {
  const a = await ensureCompany(KEY, { name: "Acme", mission: "test co" });
  expect(a.created).toBe(true);
  const b = await ensureCompany(KEY);
  expect(b.created).toBe(false);
  const c = await db.company.findUnique({ where: { key: KEY } });
  expect(c!.name).toBe("Acme");
});

test("workspace of an unknown company is an honest 'not found'", async () => {
  const r = await companyWorkspace("COTEST_ghost");
  expect("error" in r).toBe(true);
});

test("empty company workspace — every section is honestly empty (no fabrication)", async () => {
  await ensureCompany(KEY, { name: "Acme" });
  const w = await companyWorkspace(KEY) as Record<string, { leads?: number; hasRealRevenue?: boolean; hasData?: boolean; tickets?: number }>;
  expect((w.crm as { leads: number }).leads).toBe(0);
  expect((w.finance as { hasRealRevenue: boolean }).hasRealRevenue).toBe(false);
  expect((w.analytics as { hasData: boolean }).hasData).toBe(false);
  expect((w.support as { tickets: number }).tickets).toBe(0);
});

test("workspace aggregates REAL data from each module by companyKey", async () => {
  await ensureCompany(KEY, { name: "Acme" });
  // Module 2 — a lead for this company
  await db.lead.create({ data: { leadId: "LEAD-COTEST1", subject: KEY, name: "prospect co", source: "github-orgs", evidenceUrl: "https://github.com/x", industry: "SaaS", icpScore: 70, matchTier: "HIGH", status: "CUSTOMER", dataLabel: "REAL" } });
  // Module 7 — real product usage + a ticket
  await recordProductEvent({ productKey: KEY, eventType: "SIGNUP", userRef: "u1" });
  await recordProductEvent({ productKey: KEY, eventType: "FEATURE_USE", userRef: "u1", feature: "export" });
  await createTicket({ productKey: KEY, subject: "how do I export", category: "QUESTION" });
  // Module 3 — real revenue
  await recordRevenueEvent({ type: "SUBSCRIPTION", amountUsd: 50, customerId: "cust1", interval: "month", projectId: KEY });

  const w = await companyWorkspace(KEY) as Record<string, Record<string, unknown>>;
  expect((w.crm as { leads: number }).leads).toBe(1);
  expect((w.customers as { convertedLeads: number }).convertedLeads).toBe(1);
  expect((w.analytics as { activeUsers: number }).activeUsers).toBe(1);
  expect((w.support as { tickets: number }).tickets).toBe(1);
  expect((w.finance as { mrrUsd: number; hasRealRevenue: boolean }).mrrUsd).toBe(50);
  expect((w.finance as { hasRealRevenue: boolean }).hasRealRevenue).toBe(true);
});

test("company health is UNKNOWN when empty, REAL with data", async () => {
  await ensureCompany(KEY, { name: "Acme" });
  let h = await companyHealth(KEY);
  expect(h.status).toBe("UNKNOWN");
  await recordRevenueEvent({ type: "SUBSCRIPTION", amountUsd: 100, customerId: "c1", interval: "month", projectId: KEY });
  await recordProductEvent({ productKey: KEY, eventType: "SIGNUP", userRef: "u1" });
  h = await companyHealth(KEY);
  expect(h.score.label).toBe("REAL");
  expect(["HEALTHY", "STEADY", "AT_RISK"]).toContain(h.status);
  expect(h.drivers.length).toBeGreaterThan(0);
});

test("portfolio overview rolls up each company's real per-module data", async () => {
  await ensureCompany(KEY, { name: "Acme" });
  await recordRevenueEvent({ type: "SUBSCRIPTION", amountUsd: 20, customerId: "c1", interval: "month", projectId: KEY });
  const o = await companyOverview();
  const acme = o.portfolio.find((c) => c.key === KEY);
  expect(acme).toBeDefined();
  expect(acme!.mrrUsd).toBe(20);
  expect(acme!.hasRevenue).toBe(true);
});
