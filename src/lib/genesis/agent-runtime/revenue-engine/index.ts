/** Revenue Execution Engine (V10 Module 3).
 *
 * Real payment-provider sync + honest unit economics. THE CARDINAL RULE:
 * revenue Genesis has not actually earned is $0/UNKNOWN — never fabricated,
 * never forecast-as-fact. Every metric carries a label:
 *   REAL       — computed from real provider/confirmed RevenueEvent rows
 *   UNKNOWN    — not enough real data to compute honestly
 *   SIMULATION — a forecast/what-if, clearly separated from actuals
 *
 * Reuses: RevenueEvent (real ledger), GrowthExperiment kind=PRICING (pricing
 * experiments), GrowthMetric (marketing spend), the Module-1 FetchLike seam.
 */

import { db } from "@/lib/db";
import { emit } from "../event-bus";
import { PAYMENT_PROVIDERS, providerHealth, type ProviderName, type ProviderPull } from "./providers";
import type { FetchLike } from "../world-scanner/connectors";

const round2 = (n: number) => Math.round(n * 100) / 100;
const llmDisabled = () => process.env.NODE_ENV === "test" && process.env.GENESIS_TEST_ALLOW_LLM !== "1";

export type MetricLabel = "REAL" | "UNKNOWN" | "SIMULATION";
export interface Metric { value: number; label: MetricLabel; note?: string }
const unknown = (note: string): Metric => ({ value: 0, label: "UNKNOWN", note });

async function nextEventId(): Promise<string> {
  const rows = await db.revenueEvent.findMany({ where: { eventId: { not: null } }, orderBy: { createdAt: "desc" }, take: 100, select: { eventId: true } });
  let max = 0; for (const r of rows) { const m = r.eventId?.match(/^REV-(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `REV-${(max + 1).toString().padStart(6, "0")}`;
}

const realFetch: FetchLike = async (url, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try { const r = await fetch(url, { headers: init?.headers, signal: controller.signal }); return { ok: r.ok, status: r.status, json: () => r.json(), text: () => r.text() }; }
  finally { clearTimeout(timer); }
};

// ======================= PROVIDER SYNC =======================

export interface SyncResult { provider: ProviderName; synced: number; skipped: number; error?: string }

/** Pull REAL subscriptions/charges from a connected provider into the ledger.
 *  Idempotent per (provider, externalId). Never runs without a real key. */
export async function syncProvider(name: ProviderName, opts?: { fetchImpl?: FetchLike }): Promise<SyncResult> {
  const provider = PAYMENT_PROVIDERS.find((p) => p.name === name);
  if (!provider) return { provider: name, synced: 0, skipped: 0, error: "unknown provider" };
  if (!provider.available()) return { provider: name, synced: 0, skipped: 0, error: `${name} not configured — set its API key (no fabricated revenue)` };
  const fetchImpl = opts?.fetchImpl ?? realFetch;
  if (!opts?.fetchImpl && llmDisabled()) return { provider: name, synced: 0, skipped: 0, error: "NETWORK_DISABLED_IN_TESTS: inject fetchImpl" };

  let pull: ProviderPull;
  try { pull = await provider.pull!(fetchImpl); }
  catch (e) { return { provider: name, synced: 0, skipped: 0, error: e instanceof Error ? e.message : String(e) }; }

  let synced = 0, skipped = 0;
  const upsertEvent = async (type: string, externalId: string, amount: number, customerId: string, interval: string, status: string, occurredAt: string) => {
    const existing = await db.revenueEvent.findUnique({ where: { provider_externalId: { provider: name, externalId } } });
    if (existing) { // keep status current (a sub may have canceled since last sync) but never duplicate
      if (existing.status !== status) await db.revenueEvent.update({ where: { id: existing.id }, data: { status } });
      skipped++; return;
    }
    await db.revenueEvent.create({ data: { eventId: await nextEventId(), type, provider: name, externalId, amount: round2(amount), customerId, interval, status, dataLabel: "REAL", occurredAt: new Date(occurredAt) } });
    synced++;
  };
  for (const sub of pull.subscriptions) await upsertEvent("SUBSCRIPTION", sub.externalId, sub.amountUsd, sub.customerId, sub.interval, sub.status, sub.occurredAt);
  for (const ch of pull.charges) await upsertEvent(ch.refunded ? "REFUND" : "CHARGE", ch.externalId, ch.amountUsd, ch.customerId, "one_time", ch.refunded ? "REFUNDED" : "COMPLETED", ch.occurredAt);

  await emit({ agent: "REVENUE", action: "PROVIDER_SYNC", detail: `${name}: ${synced} new, ${skipped} existing real revenue record(s)`, level: "INFO", category: "REVENUE" });
  return { provider: name, synced, skipped };
}

/** Record a single REAL, human-confirmed revenue event (e.g. a manual sale). */
export async function recordRevenueEvent(input: { type: "CHARGE" | "REFUND" | "SUBSCRIPTION" | "UPGRADE" | "CHURN"; amountUsd: number; customerId?: string; interval?: "month" | "year" | "one_time"; status?: string; projectId?: string }): Promise<{ eventId: string }> {
  const eventId = await nextEventId();
  await db.revenueEvent.create({ data: {
    eventId, type: input.type, amount: round2(input.amountUsd), customerId: input.customerId ?? null,
    interval: input.interval ?? (input.type === "SUBSCRIPTION" ? "month" : "one_time"),
    status: input.status ?? (input.type === "CHURN" ? "CANCELED" : input.type === "REFUND" ? "REFUNDED" : input.type === "SUBSCRIPTION" ? "ACTIVE" : "COMPLETED"),
    provider: "manual", dataLabel: "REAL", projectId: input.projectId ?? null,
  } });
  await emit({ agent: "REVENUE", action: "REVENUE_EVENT", detail: `${eventId} ${input.type} $${round2(input.amountUsd)} (manual REAL)`, level: "SUCCESS", category: "REVENUE" });
  return { eventId };
}

/** Record REAL marketing spend so CAC can be computed honestly (else CAC is UNKNOWN). */
export async function recordMarketingSpend(amountUsd: number, opts?: { projectId?: string; period?: string }): Promise<void> {
  await db.growthMetric.create({ data: { metric: "marketing_spend", value: round2(amountUsd), unit: "usd", period: opts?.period ?? "monthly", projectId: opts?.projectId ?? null } });
}

// ======================= UNIT ECONOMICS =======================

export interface UnitEconomics {
  currency: string;
  mrr: Metric; arr: Metric; arpu: Metric;
  activeSubscribers: number; churnRatePct: Metric; ltv: Metric; cac: Metric; ltvCacRatio: Metric;
  grossRevenueUsd: Metric; refundsUsd: Metric; netRevenueUsd: Metric;
  hasRealRevenue: boolean; asOf: string;
}

/** Compute unit economics from REAL RevenueEvent rows only. With no real revenue,
 *  everything is honestly $0/UNKNOWN — never a fabricated projection. */
export async function computeUnitEconomics(): Promise<UnitEconomics> {
  const events = await db.revenueEvent.findMany({ where: { dataLabel: "REAL" } });
  const subs = events.filter((e) => e.type === "SUBSCRIPTION");
  const activeSubs = subs.filter((e) => e.status === "ACTIVE");
  const canceledSubs = subs.filter((e) => e.status === "CANCELED");
  const charges = events.filter((e) => e.type === "CHARGE" && e.status === "COMPLETED");
  const refunds = events.filter((e) => e.type === "REFUND" || e.status === "REFUNDED");

  const monthly = (e: { amount: number; interval: string }) => (e.interval === "year" ? e.amount / 12 : e.amount);
  const mrrValue = round2(activeSubs.reduce((a, e) => a + monthly(e), 0));
  const hasRealRevenue = events.length > 0;

  const mrr: Metric = activeSubs.length > 0 ? { value: mrrValue, label: "REAL" } : unknown("no active real subscriptions");
  const arr: Metric = activeSubs.length > 0 ? { value: round2(mrrValue * 12), label: "REAL" } : unknown("MRR unknown");

  const activeCustomers = new Set(activeSubs.map((e) => e.customerId).filter(Boolean)).size || activeSubs.length;
  const arpu: Metric = activeCustomers > 0 ? { value: round2(mrrValue / activeCustomers), label: "REAL" } : unknown("no active customers");

  // churn needs a real denominator; below a small sample it stays UNKNOWN (honest)
  const totalEverSubs = subs.length;
  const churnRatePct: Metric = totalEverSubs >= 5 ? { value: round2((canceledSubs.length / totalEverSubs) * 100), label: "REAL" } : unknown(`only ${totalEverSubs} subscription(s) — need ≥5 for an honest churn rate`);

  // LTV = ARPU / monthly churn rate (only when both are real)
  const monthlyChurn = churnRatePct.label === "REAL" ? churnRatePct.value / 100 : 0;
  const ltv: Metric = arpu.label === "REAL" && churnRatePct.label === "REAL" && monthlyChurn > 0
    ? { value: round2(arpu.value / monthlyChurn), label: "REAL" }
    : unknown("needs real ARPU and a real, non-zero churn rate");

  // CAC = real marketing spend / new real customers
  const spendRows = await db.growthMetric.findMany({ where: { metric: "marketing_spend" } });
  const totalSpend = spendRows.reduce((a, r) => a + r.value, 0);
  const newCustomers = new Set(events.map((e) => e.customerId).filter(Boolean)).size;
  const cac: Metric = spendRows.length > 0 && newCustomers > 0
    ? { value: round2(totalSpend / newCustomers), label: "REAL" }
    : unknown(spendRows.length === 0 ? "no real marketing spend recorded (recordMarketingSpend)" : "no acquired customers yet");

  const ltvCacRatio: Metric = ltv.label === "REAL" && cac.label === "REAL" && cac.value > 0
    ? { value: round2(ltv.value / cac.value), label: "REAL" }
    : unknown("needs real LTV and real CAC");

  const grossValue = round2(charges.reduce((a, e) => a + e.amount, 0) + activeSubs.reduce((a, e) => a + monthly(e), 0));
  const refundsValue = round2(refunds.reduce((a, e) => a + e.amount, 0));
  const grossRevenueUsd: Metric = hasRealRevenue ? { value: grossValue, label: "REAL" } : unknown("no real revenue yet");
  const refundsUsd: Metric = { value: refundsValue, label: hasRealRevenue ? "REAL" : "UNKNOWN" };
  const netRevenueUsd: Metric = hasRealRevenue ? { value: round2(grossValue - refundsValue), label: "REAL" } : unknown("no real revenue yet");

  return {
    currency: "USD", mrr, arr, arpu, activeSubscribers: activeSubs.length, churnRatePct, ltv, cac, ltvCacRatio,
    grossRevenueUsd, refundsUsd, netRevenueUsd, hasRealRevenue, asOf: new Date().toISOString(),
  };
}

// ======================= PRICING EXPERIMENTS (reuse GrowthExperiment) =======================

async function nextExperimentId(): Promise<string> {
  const rows = await db.growthExperiment.findMany({ where: { experimentId: { not: null } }, orderBy: { createdAt: "desc" }, take: 100, select: { experimentId: true } });
  let max = 0; for (const r of rows) { const m = r.experimentId?.match(/^EXP-(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `EXP-${(max + 1).toString().padStart(6, "0")}`;
}

/** Propose a real pricing experiment (A/B on price). Starts as a hypothesis with
 *  dataSource NONE — it becomes REAL only when real conversion data is attached. */
export async function proposePricingExperiment(input: { subject: string; hypothesis: string; variantA: number; variantB: number }): Promise<{ experimentId: string }> {
  const experimentId = await nextExperimentId();
  await db.growthExperiment.create({ data: {
    experimentId, name: `Pricing: $${input.variantA} vs $${input.variantB}`, hypothesis: input.hypothesis,
    kind: "PRICING", subject: input.subject, metric: "conversion_rate", dataSource: "NONE",
    result: JSON.stringify({ variantA: input.variantA, variantB: input.variantB, label: "PROPOSED — no real data yet" }),
    status: "PROPOSED",
  } });
  await emit({ agent: "REVENUE", action: "PRICING_EXPERIMENT", detail: `${experimentId} proposed: $${input.variantA} vs $${input.variantB}`, level: "INFO", category: "REVENUE" });
  return { experimentId };
}

// ======================= DASHBOARD =======================

export async function revenueOverview() {
  const econ = await computeUnitEconomics();
  const recent = await db.revenueEvent.findMany({ where: { dataLabel: "REAL" }, orderBy: { occurredAt: "desc" }, take: 25, select: { eventId: true, type: true, amount: true, provider: true, status: true, interval: true, occurredAt: true } });
  const pricingExperiments = await db.revenueEvent.count(); // total ledger size
  const experiments = await db.growthExperiment.findMany({ where: { kind: "PRICING" }, orderBy: { createdAt: "desc" }, take: 10, select: { experimentId: true, name: true, status: true, dataSource: true } });
  const byProvider = new Map<string, { count: number; usd: number }>();
  for (const e of await db.revenueEvent.findMany({ where: { dataLabel: "REAL" }, select: { provider: true, amount: true } })) {
    const c = byProvider.get(e.provider) ?? { count: 0, usd: 0 }; c.count++; c.usd = round2(c.usd + e.amount); byProvider.set(e.provider, c);
  }
  return {
    economics: econ,
    providers: providerHealth(),
    byProvider: [...byProvider.entries()].map(([provider, v]) => ({ provider, ...v })),
    ledgerSize: pricingExperiments,
    recentEvents: recent,
    pricingExperiments: experiments,
    honesty: econ.hasRealRevenue ? "REAL revenue data present" : "no real revenue yet — all figures $0/UNKNOWN by design (never fabricated)",
  };
}

export { providerHealth };
