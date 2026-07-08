import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAgent } from "@/lib/genesis/agent-runtime/agents";

/** GET /api/genesis/customers — recent customer simulations.
 *  ?limit=20  ?opportunityId=OPP-000001  ?id=SIM-000001 (include persona sample)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id") ?? undefined;
  if (id) {
    const sim = await db.customerSimulation.findUnique({ where: { simulationId: id }, include: { personas: true } });
    if (!sim) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ simulation: hydrate(sim) });
  }
  const limit = Math.min(Number(searchParams.get("limit")) || 20, 100);
  const opportunityId = searchParams.get("opportunityId") ?? undefined;
  const sims = await db.customerSimulation.findMany({ where: opportunityId ? { opportunityId } : undefined, orderBy: { createdAt: "desc" }, take: limit });
  return NextResponse.json({ simulations: sims.map(hydrate) });
}

/** POST /api/genesis/customers — run a customer-reality simulation (synchronous).
 *  body: { opportunityId? , goal?, context? }  (context may set personaCount, price, competition)
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { opportunityId, goal, context } = body as { opportunityId?: string; goal?: string; context?: Record<string, unknown> };
  if (!opportunityId && !goal) return NextResponse.json({ error: "opportunityId or goal required" }, { status: 400 });
  const result = await getAgent("CUSTOMER")!.execute({ goal: goal ?? `customer simulation for ${opportunityId}`, context: { ...(opportunityId ? { opportunityId } : {}), ...(context ?? {}) } });
  if (result.status !== "SUCCESS") return NextResponse.json({ error: result.error ?? result.summary }, { status: 500 });
  return NextResponse.json({ simulation: result.output, executionId: result.executionId });
}

function hydrate(s: Record<string, unknown> & { pricePoints: string; topObjections: string; topTriggers: string; missingFeatures: string; segments: string }) {
  return { ...s, pricePoints: safeParse(s.pricePoints), topObjections: safeParse(s.topObjections), topTriggers: safeParse(s.topTriggers), missingFeatures: safeParse(s.missingFeatures), segments: safeParse(s.segments) };
}
function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }
