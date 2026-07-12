/** Economic Brain (V10 Module 8).
 *
 * Reasons about the REAL economics of Genesis and its ventures: revenue, burn,
 * runway, margins, profit, ROI, and forecasts. The honesty spine:
 *   - BURN is always REAL — the LlmUsage ledger is genuine compute spend, plus
 *     real recorded marketing/operating costs. Genesis truly knows what it burns.
 *   - REVENUE is REAL or UNKNOWN (from the revenue engine) — never fabricated.
 *   - PROFIT with $0 revenue and real burn is a REAL loss, stated plainly.
 *   - RUNWAY is REAL only when a real cash balance was recorded, else UNKNOWN.
 *   - FORECASTS are explicitly SIMULATION with their assumptions attached — a
 *     projection is never presented as an actual.
 *
 * Reuses: revenue-engine (computeUnitEconomics, Metric), LlmUsage (real spend),
 * GrowthMetric (marketing/operating cost + cash snapshots). No new tables.
 */

import { db } from "@/lib/db";
import { emit } from "../event-bus";
import { computeUnitEconomics, type Metric } from "../revenue-engine";

const round2 = (n: number) => Math.round(n * 100) / 100;
const unknown = (note: string): Metric => ({ value: 0, label: "UNKNOWN", note });

// ======================= REAL COST / CASH INPUTS =======================

/** Record a REAL operating cost (infra, salaries, tooling) — GrowthMetric ledger. */
export async function recordOperatingCost(amountUsd: number, opts?: { category?: string; period?: string; projectId?: string }): Promise<void> {
  await db.growthMetric.create({ data: { metric: "operating_cost", value: round2(amountUsd), unit: opts?.category ?? "usd", period: opts?.period ?? "monthly", projectId: opts?.projectId ?? null } });
  await emit({ agent: "ECONOMIC", action: "OPERATING_COST", detail: `recorded $${round2(amountUsd)}/${opts?.period ?? "monthly"} ${opts?.category ?? "operating"} cost`, level: "INFO", category: "REVENUE" });
}

/** Record the current REAL cash balance (latest snapshot wins for runway). */
export async function recordCashBalance(amountUsd: number, opts?: { projectId?: string }): Promise<void> {
  await db.growthMetric.create({ data: { metric: "cash_balance", value: round2(amountUsd), unit: "usd", period: "snapshot", projectId: opts?.projectId ?? null } });
  await emit({ agent: "ECONOMIC", action: "CASH_BALANCE", detail: `cash balance snapshot $${round2(amountUsd)}`, level: "INFO", category: "REVENUE" });
}

// ======================= BURN (always REAL) =======================

export interface BurnBreakdown {
  windowDays: number;
  computeUsd: Metric;      // real LlmUsage spend
  marketingUsd: Metric;    // real recorded marketing spend
  operatingUsd: Metric;    // real recorded operating costs
  monthlyBurnUsd: Metric;  // normalized to 30 days
  note: string;
}

/** Compute REAL monthly burn from the compute ledger + recorded real costs. */
export async function computeBurn(windowDays = 30): Promise<BurnBreakdown> {
  const since = new Date(Date.now() - windowDays * 24 * 3_600_000);
  const usage = await db.llmUsage.aggregate({ _sum: { costUsd: true }, where: { createdAt: { gte: since } } });
  const compute = round2(usage._sum.costUsd ?? 0);
  const spendRows = await db.growthMetric.findMany({ where: { metric: { in: ["marketing_spend", "operating_cost"] }, recordedAt: { gte: since } } });
  const marketing = round2(spendRows.filter((r) => r.metric === "marketing_spend").reduce((a, r) => a + r.value, 0));
  const operating = round2(spendRows.filter((r) => r.metric === "operating_cost").reduce((a, r) => a + r.value, 0));
  const totalWindow = compute + marketing + operating;
  const monthly = round2((totalWindow / windowDays) * 30);
  // compute spend is ALWAYS real (it happened); marketing/operating are real if recorded
  return {
    windowDays,
    computeUsd: { value: compute, label: "REAL", note: "actual LLM spend from the usage ledger (free models = $0)" },
    marketingUsd: spendRows.some((r) => r.metric === "marketing_spend") ? { value: marketing, label: "REAL" } : unknown("no marketing spend recorded"),
    operatingUsd: spendRows.some((r) => r.metric === "operating_cost") ? { value: operating, label: "REAL" } : unknown("no operating cost recorded"),
    monthlyBurnUsd: { value: monthly, label: "REAL", note: "real spend normalized to 30 days" },
    note: "burn is REAL — compute spend is genuine; marketing/operating included when recorded",
  };
}

// ======================= RUNWAY =======================

async function latestCashBalance(): Promise<number | null> {
  const row = await db.growthMetric.findFirst({ where: { metric: "cash_balance" }, orderBy: { recordedAt: "desc" } });
  return row ? row.value : null;
}

export interface Runway { cashUsd: Metric; monthlyBurnUsd: Metric; runwayMonths: Metric; zeroDate: string | null }

/** Runway = real cash / real monthly burn. UNKNOWN without a recorded cash balance. */
export async function computeRunway(): Promise<Runway> {
  const burn = await computeBurn(30);
  const cash = await latestCashBalance();
  const monthlyBurn = burn.monthlyBurnUsd.value;
  if (cash === null) return { cashUsd: unknown("no cash balance recorded (recordCashBalance)"), monthlyBurnUsd: burn.monthlyBurnUsd, runwayMonths: unknown("needs a real cash balance"), zeroDate: null };
  if (monthlyBurn <= 0) return { cashUsd: { value: cash, label: "REAL" }, monthlyBurnUsd: burn.monthlyBurnUsd, runwayMonths: { value: 0, label: "UNKNOWN", note: "no burn — runway effectively unbounded" }, zeroDate: null };
  const months = round2(cash / monthlyBurn);
  const zeroDate = new Date(Date.now() + months * 30 * 24 * 3_600_000).toISOString().slice(0, 10);
  return { cashUsd: { value: cash, label: "REAL" }, monthlyBurnUsd: burn.monthlyBurnUsd, runwayMonths: { value: months, label: "REAL" }, zeroDate };
}

// ======================= PROFIT / MARGINS =======================

export interface Profitability {
  monthlyRevenueUsd: Metric; monthlyBurnUsd: Metric; monthlyProfitUsd: Metric;
  grossMarginPct: Metric; profitable: boolean | null; note: string;
}

/** Profit = real monthly revenue (MRR) − real monthly burn. A real loss is stated as one. */
export async function computeProfitability(): Promise<Profitability> {
  const econ = await computeUnitEconomics();
  const burn = await computeBurn(30);
  const mrr = econ.mrr.label === "REAL" ? econ.mrr.value : 0;
  const monthlyBurn = burn.monthlyBurnUsd.value;
  const hasRevenue = econ.mrr.label === "REAL";
  const profit = round2(mrr - monthlyBurn);
  // gross margin needs revenue; COGS proxy = compute cost attributable to serving
  const grossMargin: Metric = hasRevenue && mrr > 0 ? { value: round2(((mrr - burn.computeUsd.value) / mrr) * 100), label: "REAL" } : unknown("no real revenue — margin undefined");
  return {
    monthlyRevenueUsd: hasRevenue ? { value: mrr, label: "REAL" } : unknown("no real revenue yet"),
    monthlyBurnUsd: burn.monthlyBurnUsd,
    monthlyProfitUsd: { value: profit, label: "REAL", note: hasRevenue ? undefined : "revenue $0 (real) − real burn = a real loss" },
    grossMarginPct: grossMargin,
    profitable: monthlyBurn === 0 && !hasRevenue ? null : profit >= 0,
    note: hasRevenue ? "real revenue vs real burn" : "no revenue yet; the loss shown is real burn against $0 real revenue",
  };
}

// ======================= ROI =======================

/** Marketing ROI = (real revenue − real marketing spend) / real marketing spend. */
export async function computeROI(): Promise<{ marketingRoi: Metric; ltvCacRatio: Metric; note: string }> {
  const econ = await computeUnitEconomics();
  const spendRows = await db.growthMetric.findMany({ where: { metric: "marketing_spend" } });
  const spend = round2(spendRows.reduce((a, r) => a + r.value, 0));
  const revenue = econ.netRevenueUsd.label === "REAL" ? econ.netRevenueUsd.value : 0;
  const marketingRoi: Metric = spendRows.length > 0 && spend > 0 && econ.netRevenueUsd.label === "REAL"
    ? { value: round2(((revenue - spend) / spend) * 100), label: "REAL" }
    : unknown(spendRows.length === 0 ? "no real marketing spend recorded" : "no real revenue to attribute");
  return { marketingRoi, ltvCacRatio: econ.ltvCacRatio, note: "ROI requires both real spend and real revenue; otherwise UNKNOWN" };
}

// ======================= FORECAST (SIMULATION) =======================

export interface ForecastPoint { month: number; mrrUsd: number; burnUsd: number; netUsd: number; cashUsd: number | null }
export interface Forecast { label: "SIMULATION"; assumptions: Record<string, number>; months: number; points: ForecastPoint[]; note: string }

/** Project MRR/burn/cash forward. ALWAYS labeled SIMULATION — a forecast is a
 *  what-if built on stated assumptions, never presented as actuals. */
export async function forecast(opts?: { months?: number; mrrGrowthPct?: number; burnGrowthPct?: number }): Promise<Forecast> {
  const months = Math.min(Math.max(opts?.months ?? 12, 1), 60);
  const mrrGrowth = (opts?.mrrGrowthPct ?? 15) / 100;   // default assumption, stated
  const burnGrowth = (opts?.burnGrowthPct ?? 5) / 100;
  const econ = await computeUnitEconomics();
  const burn = await computeBurn(30);
  const cash0 = await latestCashBalance();
  let mrr = econ.mrr.label === "REAL" ? econ.mrr.value : 0;
  let monthlyBurn = burn.monthlyBurnUsd.value;
  let cash = cash0;
  const points: ForecastPoint[] = [];
  for (let m = 1; m <= months; m++) {
    mrr = round2(mrr * (1 + mrrGrowth));
    monthlyBurn = round2(monthlyBurn * (1 + burnGrowth));
    const net = round2(mrr - monthlyBurn);
    if (cash !== null) cash = round2(cash + net);
    points.push({ month: m, mrrUsd: mrr, burnUsd: monthlyBurn, netUsd: net, cashUsd: cash });
  }
  return {
    label: "SIMULATION",
    assumptions: { startMrrUsd: econ.mrr.label === "REAL" ? econ.mrr.value : 0, startMonthlyBurnUsd: burn.monthlyBurnUsd.value, startCashUsd: cash0 ?? 0, mrrGrowthPctMonthly: (opts?.mrrGrowthPct ?? 15), burnGrowthPctMonthly: (opts?.burnGrowthPct ?? 5) },
    months, points,
    note: "SIMULATION — a projection from stated assumptions on REAL starting values. Not actuals; do not report as revenue.",
  };
}

// ======================= ECONOMIC HEALTH + OVERVIEW =======================

export async function economicHealth(): Promise<{ assessment: string; signals: string[]; label: "REAL" | "UNKNOWN" }> {
  const [runway, prof] = await Promise.all([computeRunway(), computeProfitability()]);
  const signals: string[] = [];
  if (prof.monthlyRevenueUsd.label !== "REAL") signals.push("pre-revenue (real $0)");
  signals.push(`burn $${prof.monthlyBurnUsd.value}/mo (real)`);
  if (runway.runwayMonths.label === "REAL") signals.push(`runway ${runway.runwayMonths.value} months`);
  else signals.push("runway UNKNOWN (record a cash balance)");
  let assessment = "PRE_REVENUE_BURN";
  if (prof.profitable === true) assessment = "PROFITABLE";
  else if (runway.runwayMonths.label === "REAL" && runway.runwayMonths.value < 3) assessment = "RUNWAY_CRITICAL";
  else if (prof.monthlyRevenueUsd.label === "REAL") assessment = "REVENUE_NEGATIVE_MARGIN";
  return { assessment, signals, label: runway.runwayMonths.label === "REAL" || prof.monthlyRevenueUsd.label === "REAL" ? "REAL" : "UNKNOWN" };
}

export async function economicOverview() {
  const [burn, runway, prof, roi, health, econ] = await Promise.all([
    computeBurn(30), computeRunway(), computeProfitability(), computeROI(), economicHealth(), computeUnitEconomics(),
  ]);
  return {
    revenue: { mrr: econ.mrr, arr: econ.arr, netRevenueUsd: econ.netRevenueUsd },
    burn, runway, profitability: prof, roi, health,
    hasRealRevenue: econ.hasRealRevenue,
    note: "burn is REAL (compute + recorded costs); revenue/runway REAL or UNKNOWN; forecasts are SIMULATION — nothing fabricated",
  };
}
