import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guardWrite } from "@/lib/api-guard";
import {
  revenueOverview, computeUnitEconomics, syncProvider, recordRevenueEvent,
  recordMarketingSpend, proposePricingExperiment,
} from "@/lib/genesis/agent-runtime/revenue-engine";
import type { ProviderName } from "@/lib/genesis/agent-runtime/revenue-engine/providers";

/** GET /api/genesis/revenue — models + events (legacy), plus V10 Module 3 views:
 *  ?overview=1 → full revenue dashboard  ·  ?economics=1 → unit economics only
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("economics") === "1") return NextResponse.json(await computeUnitEconomics());
  if (searchParams.get("overview") === "1") return NextResponse.json(await revenueOverview());
  const projectId = searchParams.get("projectId");
  const where: Record<string, unknown> = {};
  if (projectId) where.projectId = projectId;
  const models = await db.revenueModel.findMany({ where, orderBy: { createdAt: "desc" } });
  const events = await db.revenueEvent.findMany({ where, orderBy: { createdAt: "desc" }, take: 50 });
  return NextResponse.json({ models, events });
}

/** POST /api/genesis/revenue — { action, ... }. Never fabricates revenue.
 *  actions: sync | event | spend | pricing
 */
export async function POST(req: NextRequest) {
  const g = await guardWrite(req, "MEMBER");
  if (!g.ok) return g.res;
  const b = await req.json().catch(() => ({}));
  const { action } = b as { action?: string };

  switch (action) {
    case "sync": {
      if (!b.provider) return NextResponse.json({ error: "provider required (stripe|lemonsqueezy|polar|paddle)" }, { status: 400 });
      const r = await syncProvider(b.provider as ProviderName);
      return NextResponse.json(r, { status: r.error ? 400 : 200 });
    }
    case "event": {
      if (!b.type || typeof b.amountUsd !== "number") return NextResponse.json({ error: "type and amountUsd required" }, { status: 400 });
      return NextResponse.json(await recordRevenueEvent({ type: b.type, amountUsd: b.amountUsd, customerId: b.customerId, interval: b.interval, projectId: b.projectId }));
    }
    case "spend": {
      if (typeof b.amountUsd !== "number") return NextResponse.json({ error: "amountUsd required" }, { status: 400 });
      await recordMarketingSpend(b.amountUsd, { projectId: b.projectId, period: b.period });
      return NextResponse.json({ ok: true });
    }
    case "pricing": {
      if (!b.subject || typeof b.variantA !== "number" || typeof b.variantB !== "number") return NextResponse.json({ error: "subject, variantA, variantB required" }, { status: 400 });
      return NextResponse.json(await proposePricingExperiment({ subject: b.subject, hypothesis: b.hypothesis ?? "price sensitivity test", variantA: b.variantA, variantB: b.variantB }));
    }
    default:
      return NextResponse.json({ error: "action must be sync|event|spend|pricing" }, { status: 400 });
  }
}
