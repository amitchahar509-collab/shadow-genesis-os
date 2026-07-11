/** V10 Module 3 — Revenue Execution. The cardinal rule under test: revenue Genesis
 *  has NOT earned is $0/UNKNOWN, never fabricated. Provider sync is idempotent and
 *  key-gated; unit economics compute from real rows only. Network-free via seam. */

import { test, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { db } from "@/lib/db";
import { computeUnitEconomics, recordRevenueEvent, recordMarketingSpend, syncProvider, proposePricingExperiment } from "@/lib/genesis/agent-runtime/revenue-engine";
import type { FetchLike } from "@/lib/genesis/agent-runtime/world-scanner/connectors";

const PKEYS = ["STRIPE_API_KEY", "LEMONSQUEEZY_API_KEY", "POLAR_API_KEY", "PADDLE_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of PKEYS) saved[k] = process.env[k];

async function wipe() {
  await db.revenueEvent.deleteMany({ where: { OR: [{ provider: "stripe" }, { provider: "manual" }, { customerId: { startsWith: "REVTEST" } }, { externalId: { startsWith: "sub_REVTEST" } }, { externalId: { startsWith: "ch_REVTEST" } }] } });
  await db.growthMetric.deleteMany({ where: { metric: "marketing_spend" } });
  await db.growthExperiment.deleteMany({ where: { subject: { startsWith: "REVTEST" } } });
}
beforeEach(async () => { for (const k of PKEYS) delete process.env[k]; await wipe(); });
afterEach(() => { for (const k of PKEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
afterAll(wipe);

// a fake Stripe response: 2 active monthly subs ($20, $50) + 1 canceled + 1 charge
const fakeStripe: FetchLike = async (url) => {
  const body = url.includes("/subscriptions")
    ? { data: [
        { id: "sub_REVTEST1", customer: "REVTEST_c1", status: "active", created: 1_700_000_000, items: { data: [{ price: { unit_amount: 2000, recurring: { interval: "month" } } }] } },
        { id: "sub_REVTEST2", customer: "REVTEST_c2", status: "active", created: 1_700_000_000, items: { data: [{ price: { unit_amount: 5000, recurring: { interval: "month" } } }] } },
        { id: "sub_REVTEST3", customer: "REVTEST_c3", status: "canceled", created: 1_700_000_000, items: { data: [{ price: { unit_amount: 2000, recurring: { interval: "month" } } }] } },
      ] }
    : url.includes("/charges")
    ? { data: [{ id: "ch_REVTEST1", customer: "REVTEST_c1", amount: 2000, refunded: false, paid: true, created: 1_700_000_000 }] }
    : {};
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
};

test("NO real revenue → everything is $0/UNKNOWN, never fabricated", async () => {
  const e = await computeUnitEconomics();
  expect(e.hasRealRevenue).toBe(false);
  expect(e.mrr.label).toBe("UNKNOWN");
  expect(e.arr.label).toBe("UNKNOWN");
  expect(e.ltv.label).toBe("UNKNOWN");
  expect(e.cac.label).toBe("UNKNOWN");
  expect(e.mrr.value).toBe(0);
  expect(e.netRevenueUsd.value).toBe(0);
});

test("provider sync is KEY-GATED — refuses without a real key (no fabricated revenue)", async () => {
  const r = await syncProvider("stripe", { fetchImpl: fakeStripe });
  expect(r.synced).toBe(0);
  expect(r.error).toContain("not configured");
});

test("connected Stripe syncs REAL rows and computes REAL MRR/ARR", async () => {
  process.env.STRIPE_API_KEY = "sk_test_REVTEST";
  const r = await syncProvider("stripe", { fetchImpl: fakeStripe });
  expect(r.synced).toBe(4); // 3 subs + 1 charge
  const e = await computeUnitEconomics();
  expect(e.hasRealRevenue).toBe(true);
  expect(e.mrr.label).toBe("REAL");
  expect(e.mrr.value).toBe(70); // $20 + $50 active monthly (canceled excluded)
  expect(e.arr.value).toBe(840); // 70 × 12
  expect(e.activeSubscribers).toBe(2);
  expect(e.arpu.value).toBe(35); // 70 / 2 customers
});

test("provider sync is idempotent per (provider, externalId)", async () => {
  process.env.STRIPE_API_KEY = "sk_test_REVTEST";
  await syncProvider("stripe", { fetchImpl: fakeStripe });
  const r2 = await syncProvider("stripe", { fetchImpl: fakeStripe });
  expect(r2.synced).toBe(0); // nothing new
  expect(r2.skipped).toBe(4);
  const count = await db.revenueEvent.count({ where: { provider: "stripe", externalId: { startsWith: "sub_REVTEST" } } });
  expect(count).toBe(3); // no duplicates
});

test("churn stays UNKNOWN below a real sample, becomes REAL with enough subscriptions", async () => {
  process.env.STRIPE_API_KEY = "sk_test_REVTEST";
  await syncProvider("stripe", { fetchImpl: fakeStripe }); // only 3 subs
  let e = await computeUnitEconomics();
  expect(e.churnRatePct.label).toBe("UNKNOWN"); // < 5 subs
  // add real manual subscriptions to cross the honesty threshold
  for (let i = 0; i < 3; i++) await recordRevenueEvent({ type: "SUBSCRIPTION", amountUsd: 30, customerId: `REVTEST_m${i}`, interval: "month" });
  e = await computeUnitEconomics();
  expect(e.churnRatePct.label).toBe("REAL"); // now 6 subs, 1 canceled → 16.67%
  expect(e.churnRatePct.value).toBeCloseTo((1 / 6) * 100, 1);
});

test("CAC is UNKNOWN without real spend, REAL once real spend is recorded", async () => {
  await recordRevenueEvent({ type: "CHARGE", amountUsd: 100, customerId: "REVTEST_c1" });
  let e = await computeUnitEconomics();
  expect(e.cac.label).toBe("UNKNOWN");
  expect(e.cac.note).toContain("no real marketing spend");
  await recordMarketingSpend(50);
  e = await computeUnitEconomics();
  expect(e.cac.label).toBe("REAL");
  expect(e.cac.value).toBe(50); // $50 spend / 1 customer
});

test("refunds reduce net revenue (real ledger arithmetic)", async () => {
  await recordRevenueEvent({ type: "CHARGE", amountUsd: 100, customerId: "REVTEST_c1" });
  await recordRevenueEvent({ type: "REFUND", amountUsd: 30, customerId: "REVTEST_c1" });
  const e = await computeUnitEconomics();
  expect(e.grossRevenueUsd.value).toBe(100);
  expect(e.refundsUsd.value).toBe(30);
  expect(e.netRevenueUsd.value).toBe(70);
});

test("test-env network lockout: sync without a seam touches no network", async () => {
  process.env.STRIPE_API_KEY = "sk_test_REVTEST";
  const r = await syncProvider("stripe"); // no fetchImpl
  expect(r.synced).toBe(0);
  expect(r.error).toContain("NETWORK_DISABLED_IN_TESTS");
});

test("pricing experiment starts as a PROPOSED hypothesis with NO real data", async () => {
  const r = await proposePricingExperiment({ subject: "REVTEST-opp", hypothesis: "lower price lifts conversion", variantA: 19, variantB: 29 });
  expect(r.experimentId).toMatch(/^EXP-/);
  const row = await db.growthExperiment.findUnique({ where: { experimentId: r.experimentId } });
  expect(row!.kind).toBe("PRICING");
  expect(row!.dataSource).toBe("NONE"); // honest: no real data until conversions arrive
});
