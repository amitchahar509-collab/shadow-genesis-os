/** Payment-provider connectors (V10 Module 3) — REAL revenue integrations.
 *
 * Every connector is KEY-GATED: it activates only when its real API key is set,
 * and then pulls REAL subscription/charge data from the provider. With no key it
 * is honestly UNAVAILABLE — never a mock, never a fabricated dollar. Revenue that
 * Genesis has not actually earned is $0/UNKNOWN, always.
 *
 * Reuses the World Scanner's FetchLike seam so tests inject a fake fetch and no
 * network is touched under `bun test`.
 */

import type { FetchLike } from "../world-scanner/connectors";

export type ProviderName = "stripe" | "lemonsqueezy" | "polar" | "paddle";

/** Normalized REAL records pulled from a provider. */
export interface ProviderSubscription { externalId: string; customerId: string; amountUsd: number; interval: "month" | "year"; status: "ACTIVE" | "CANCELED"; occurredAt: string }
export interface ProviderCharge { externalId: string; customerId: string; amountUsd: number; refunded: boolean; occurredAt: string }
export interface ProviderPull { provider: ProviderName; subscriptions: ProviderSubscription[]; charges: ProviderCharge[] }

export interface PaymentProvider {
  name: ProviderName;
  note: string;
  available(): boolean;
  pull?(fetchImpl: FetchLike): Promise<ProviderPull>;
}

const UA = { "user-agent": "ShadowGenesisOS/1.0 (revenue-sync)" };
const s = (v: unknown) => (typeof v === "string" ? v : "");
const cents = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v / 100 : 0);
const iso = (unixSecs: unknown) => (typeof unixSecs === "number" ? new Date(unixSecs * 1000).toISOString() : new Date().toISOString());

async function getJson(fetchImpl: FetchLike, url: string, key: string): Promise<unknown> {
  const r = await fetchImpl(url, { headers: { ...UA, authorization: `Bearer ${key}`, accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP_${r.status} ${url.split("?")[0]}`);
  return r.json();
}

/** Stripe — the real recurring-revenue source of truth when STRIPE_API_KEY is set. */
export const stripe: PaymentProvider = {
  name: "stripe", note: "set STRIPE_API_KEY (sk_...) to sync real subscriptions + charges",
  available: () => !!process.env.STRIPE_API_KEY,
  async pull(fetchImpl) {
    const key = process.env.STRIPE_API_KEY!;
    const subsRaw = await getJson(fetchImpl, "https://api.stripe.com/v1/subscriptions?status=all&limit=100", key) as { data?: { id?: string; customer?: string; status?: string; items?: { data?: { price?: { unit_amount?: number; recurring?: { interval?: string } } }[] }; created?: number }[] };
    const subscriptions: ProviderSubscription[] = (subsRaw.data ?? []).map((sub) => {
      const price = sub.items?.data?.[0]?.price;
      return {
        externalId: s(sub.id), customerId: s(sub.customer),
        amountUsd: cents(price?.unit_amount),
        interval: price?.recurring?.interval === "year" ? "year" as const : "month" as const,
        status: sub.status === "active" || sub.status === "trialing" ? "ACTIVE" as const : "CANCELED" as const,
        occurredAt: iso(sub.created),
      };
    }).filter((x) => x.externalId);
    const chRaw = await getJson(fetchImpl, "https://api.stripe.com/v1/charges?limit=100", key) as { data?: { id?: string; customer?: string; amount?: number; refunded?: boolean; created?: number; paid?: boolean }[] };
    const charges: ProviderCharge[] = (chRaw.data ?? []).filter((c) => c.paid).map((c) => ({ externalId: s(c.id), customerId: s(c.customer), amountUsd: cents(c.amount), refunded: !!c.refunded, occurredAt: iso(c.created) })).filter((x) => x.externalId);
    return { provider: "stripe", subscriptions, charges };
  },
};

/** Lemon Squeezy — LEMONSQUEEZY_API_KEY. */
export const lemonsqueezy: PaymentProvider = {
  name: "lemonsqueezy", note: "set LEMONSQUEEZY_API_KEY to sync real subscriptions",
  available: () => !!process.env.LEMONSQUEEZY_API_KEY,
  async pull(fetchImpl) {
    const key = process.env.LEMONSQUEEZY_API_KEY!;
    const d = await getJson(fetchImpl, "https://api.lemonsqueezy.com/v1/subscriptions?page[size]=100", key) as { data?: { id?: string; attributes?: { status?: string; customer_id?: number | string; created_at?: string; first_subscription_item?: { price?: number } } }[] };
    const subscriptions: ProviderSubscription[] = (d.data ?? []).map((sub) => {
      const a = sub.attributes ?? {};
      return {
        externalId: s(sub.id), customerId: String(a.customer_id ?? ""),
        amountUsd: cents(a.first_subscription_item?.price), interval: "month" as const,
        status: a.status === "active" || a.status === "on_trial" ? "ACTIVE" as const : "CANCELED" as const,
        occurredAt: s(a.created_at) || new Date().toISOString(),
      };
    }).filter((x) => x.externalId);
    return { provider: "lemonsqueezy", subscriptions, charges: [] };
  },
};

/** Polar — POLAR_API_KEY. */
export const polar: PaymentProvider = {
  name: "polar", note: "set POLAR_API_KEY to sync real subscriptions",
  available: () => !!process.env.POLAR_API_KEY,
  async pull(fetchImpl) {
    const key = process.env.POLAR_API_KEY!;
    const d = await getJson(fetchImpl, "https://api.polar.sh/v1/subscriptions?limit=100", key) as { items?: { id?: string; customer_id?: string; status?: string; amount?: number; recurring_interval?: string; created_at?: string }[] };
    const subscriptions: ProviderSubscription[] = (d.items ?? []).map((sub) => ({
      externalId: s(sub.id), customerId: s(sub.customer_id), amountUsd: cents(sub.amount),
      interval: sub.recurring_interval === "year" ? "year" as const : "month" as const,
      status: sub.status === "active" ? "ACTIVE" as const : "CANCELED" as const,
      occurredAt: s(sub.created_at) || new Date().toISOString(),
    })).filter((x) => x.externalId);
    return { provider: "polar", subscriptions, charges: [] };
  },
};

/** Paddle — PADDLE_API_KEY. */
export const paddle: PaymentProvider = {
  name: "paddle", note: "set PADDLE_API_KEY to sync real subscriptions",
  available: () => !!process.env.PADDLE_API_KEY,
  async pull(fetchImpl) {
    const key = process.env.PADDLE_API_KEY!;
    const d = await getJson(fetchImpl, "https://api.paddle.com/subscriptions?per_page=100", key) as { data?: { id?: string; customer_id?: string; status?: string; billing_cycle?: { interval?: string }; items?: { price?: { unit_price?: { amount?: string } } }[]; created_at?: string }[] };
    const subscriptions: ProviderSubscription[] = (d.data ?? []).map((sub) => {
      const amtStr = sub.items?.[0]?.price?.unit_price?.amount;
      return {
        externalId: s(sub.id), customerId: s(sub.customer_id),
        amountUsd: cents(amtStr ? parseInt(amtStr, 10) : 0),
        interval: sub.billing_cycle?.interval === "year" ? "year" as const : "month" as const,
        status: sub.status === "active" || sub.status === "trialing" ? "ACTIVE" as const : "CANCELED" as const,
        occurredAt: s(sub.created_at) || new Date().toISOString(),
      };
    }).filter((x) => x.externalId);
    return { provider: "paddle", subscriptions, charges: [] };
  },
};

export const PAYMENT_PROVIDERS: PaymentProvider[] = [stripe, lemonsqueezy, polar, paddle];

export function providerHealth(): { name: ProviderName; available: boolean; note: string }[] {
  return PAYMENT_PROVIDERS.map((p) => ({ name: p.name, available: p.available(), note: p.note }));
}
