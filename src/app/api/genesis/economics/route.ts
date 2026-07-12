import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import {
  economicOverview, computeBurn, computeRunway, computeProfitability, computeROI,
  economicHealth, forecast, recordOperatingCost, recordCashBalance,
} from "@/lib/genesis/agent-runtime/economic-brain";

/** GET /api/genesis/economics — economic dashboard (burn, runway, profit, ROI, health).
 *  ?burn=1  ?runway=1  ?profit=1  ?roi=1  ?health=1  ?forecast=1&months=&mrrGrowth=&burnGrowth=
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("burn") === "1") return NextResponse.json(await computeBurn(Number(searchParams.get("days")) || 30));
  if (searchParams.get("runway") === "1") return NextResponse.json(await computeRunway());
  if (searchParams.get("profit") === "1") return NextResponse.json(await computeProfitability());
  if (searchParams.get("roi") === "1") return NextResponse.json(await computeROI());
  if (searchParams.get("health") === "1") return NextResponse.json(await economicHealth());
  if (searchParams.get("forecast") === "1") return NextResponse.json(await forecast({ months: Number(searchParams.get("months")) || 12, mrrGrowthPct: searchParams.has("mrrGrowth") ? Number(searchParams.get("mrrGrowth")) : undefined, burnGrowthPct: searchParams.has("burnGrowth") ? Number(searchParams.get("burnGrowth")) : undefined }));
  return NextResponse.json(await economicOverview());
}

/** POST /api/genesis/economics — { action, ... }. Real inputs only; no fabricated figures.
 *  actions: operating-cost | cash-balance
 */
export async function POST(req: NextRequest) {
  const g = await guardWrite(req, "MEMBER");
  if (!g.ok) return g.res;
  const b = await req.json().catch(() => ({}));
  const { action } = b as { action?: string };

  switch (action) {
    case "operating-cost": {
      if (typeof b.amountUsd !== "number") return NextResponse.json({ error: "amountUsd required" }, { status: 400 });
      await recordOperatingCost(b.amountUsd, { category: b.category, period: b.period, projectId: b.projectId });
      return NextResponse.json({ ok: true });
    }
    case "cash-balance": {
      if (typeof b.amountUsd !== "number") return NextResponse.json({ error: "amountUsd required" }, { status: 400 });
      await recordCashBalance(b.amountUsd, { projectId: b.projectId });
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ error: "action must be operating-cost|cash-balance" }, { status: 400 });
  }
}
