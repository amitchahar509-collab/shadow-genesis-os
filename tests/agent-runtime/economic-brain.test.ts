/** V10 Module 8 — Economic Brain. Burn is always REAL (compute ledger); revenue/
 *  runway REAL or UNKNOWN; profit at $0 revenue is a REAL loss; forecasts are
 *  SIMULATION. Nothing fabricated. Network-free. */

import { test, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { db } from "@/lib/db";
import {
  computeBurn, computeRunway, computeProfitability, computeROI, forecast,
  economicHealth, recordOperatingCost, recordCashBalance,
} from "@/lib/genesis/agent-runtime/economic-brain";
import { recordRevenueEvent, recordMarketingSpend } from "@/lib/genesis/agent-runtime/revenue-engine";

const CUST = "ECOTEST_c";

async function wipe() {
  await db.growthMetric.deleteMany({ where: { metric: { in: ["marketing_spend", "operating_cost", "cash_balance"] } } });
  await db.revenueEvent.deleteMany({ where: { customerId: { startsWith: "ECOTEST" } } }); // scoped — never touch unrelated real revenue
  await db.llmUsage.deleteMany({ where: { agent: "ECOTEST" } });
}
beforeEach(wipe);
afterEach(wipe);
afterAll(wipe);

async function seedComputeSpend(usd: number) {
  await db.llmUsage.create({ data: { agent: "ECOTEST", capability: "REASONING", provider: "openrouter", model: "test", promptTokens: 100, completionTokens: 100, totalTokens: 200, costUsd: usd, durationMs: 500, ok: true } });
}

test("burn is ALWAYS real — compute spend from the usage ledger", async () => {
  const base = (await computeBurn(30)).computeUsd.value; // real ledger may already hold spend
  await seedComputeSpend(3.0);
  const burn = await computeBurn(30);
  expect(burn.computeUsd.label).toBe("REAL");
  expect(burn.computeUsd.value).toBeCloseTo(base + 3.0, 2); // our seed is included in the real total
  expect(burn.monthlyBurnUsd.label).toBe("REAL");
  expect(burn.marketingUsd.label).toBe("UNKNOWN"); // none recorded
});

test("burn includes real recorded marketing + operating costs", async () => {
  await seedComputeSpend(2.0);
  await recordMarketingSpend(100);
  await recordOperatingCost(500, { category: "infra" });
  const burn = await computeBurn(30);
  expect(burn.marketingUsd.value).toBe(100); // isolated metric — no other marketing rows in window
  expect(burn.operatingUsd.value).toBe(500);
  expect(burn.monthlyBurnUsd.value).toBeGreaterThanOrEqual(602); // (compute≥2 + 100 + 500)
});

test("runway is UNKNOWN without a cash balance, REAL once recorded", async () => {
  await recordOperatingCost(300, { period: "monthly" });
  let r = await computeRunway();
  expect(r.runwayMonths.label).toBe("UNKNOWN");
  expect(r.cashUsd.label).toBe("UNKNOWN");
  await recordCashBalance(3000);
  r = await computeRunway();
  expect(r.cashUsd.label).toBe("REAL");
  expect(r.runwayMonths.label).toBe("REAL");
  expect(r.runwayMonths.value).toBeCloseTo(10, 0); // 3000 / 300
  expect(r.zeroDate).not.toBeNull();
});

test("latest cash balance snapshot wins for runway", async () => {
  await recordOperatingCost(100, { period: "monthly" });
  await recordCashBalance(1000);
  await recordCashBalance(5000); // newer
  const r = await computeRunway();
  expect(r.cashUsd.value).toBe(5000);
});

test("profit at $0 revenue is a REAL loss, stated plainly (never hidden)", async () => {
  await seedComputeSpend(4.0);
  const p = await computeProfitability();
  expect(p.monthlyRevenueUsd.label).toBe("UNKNOWN"); // no real revenue
  expect(p.monthlyBurnUsd.label).toBe("REAL");
  expect(p.monthlyProfitUsd.label).toBe("REAL"); // the loss is real
  expect(p.monthlyProfitUsd.value).toBeLessThan(0);
  expect(p.monthlyProfitUsd.note).toContain("real loss");
  expect(p.profitable).toBe(false);
});

test("with real revenue, profit and gross margin compute REAL", async () => {
  await seedComputeSpend(1.0);
  for (let i = 0; i < 3; i++) await recordRevenueEvent({ type: "SUBSCRIPTION", amountUsd: 100, customerId: `${CUST}${i}`, interval: "month" });
  const p = await computeProfitability();
  expect(p.monthlyRevenueUsd.label).toBe("REAL");
  expect(p.monthlyRevenueUsd.value).toBe(300); // 3 × $100 MRR
  expect(p.grossMarginPct.label).toBe("REAL");
  expect(p.profitable).toBe(true); // $300 MRR >> tiny burn
});

test("ROI is UNKNOWN without both real spend and real revenue", async () => {
  let roi = await computeROI();
  expect(roi.marketingRoi.label).toBe("UNKNOWN");
  await recordMarketingSpend(50);
  for (let i = 0; i < 3; i++) await recordRevenueEvent({ type: "CHARGE", amountUsd: 100, customerId: `${CUST}${i}` });
  roi = await computeROI();
  expect(roi.marketingRoi.label).toBe("REAL"); // (300 - 50)/50 = 500%
  expect(roi.marketingRoi.value).toBe(500);
});

test("forecast is ALWAYS labeled SIMULATION with its assumptions", async () => {
  await seedComputeSpend(2.0);
  const f = await forecast({ months: 6, mrrGrowthPct: 20, burnGrowthPct: 10 });
  expect(f.label).toBe("SIMULATION");
  expect(f.points.length).toBe(6);
  expect(f.assumptions.mrrGrowthPctMonthly).toBe(20);
  expect(f.note).toContain("SIMULATION");
  // burn compounds upward at the stated rate
  expect(f.points[5].burnUsd).toBeGreaterThan(f.points[0].burnUsd);
});

test("economic health: pre-revenue burn is assessed honestly", async () => {
  await seedComputeSpend(5.0);
  const h = await economicHealth();
  expect(h.assessment).toBe("PRE_REVENUE_BURN");
  expect(h.signals.some((s) => s.includes("pre-revenue"))).toBe(true);
  expect(h.signals.some((s) => s.includes("runway UNKNOWN"))).toBe(true);
});

test("runway critical flag fires on a real short runway", async () => {
  await recordOperatingCost(1000, { period: "monthly" });
  await recordCashBalance(1500); // 1.5 months
  const h = await economicHealth();
  expect(h.assessment).toBe("RUNWAY_CRITICAL");
});
