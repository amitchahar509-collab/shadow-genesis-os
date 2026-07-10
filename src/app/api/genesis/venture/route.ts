import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import { db } from "@/lib/db";
import { getAgent } from "@/lib/genesis/agent-runtime/agents";

/** GET /api/genesis/venture — recent venture analyses.
 *  Query: ?limit=20  ?verdict=INVEST|WATCH|PASS  ?opportunityId=OPP-000001
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit")) || 20, 100);
  const verdict = searchParams.get("verdict") ?? undefined;
  const opportunityId = searchParams.get("opportunityId") ?? undefined;
  const analyses = await db.ventureAnalysis.findMany({
    where: { ...(verdict ? { verdict } : {}), ...(opportunityId ? { opportunityId } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return NextResponse.json({
    analyses: analyses.map((a) => ({ ...a, risks: safeParse(a.risks), unknowns: safeParse(a.unknowns) })),
  });
}

/** POST /api/genesis/venture — judge an opportunity (or raw goal) like a VC (synchronous).
 *  body: { opportunityId? , goal?, context? }  (one of opportunityId | goal required)
 */
export async function POST(req: NextRequest) {
  const _a = await guardWrite(req, "MEMBER"); if (!_a.ok) return _a.res;
  const body = await req.json().catch(() => ({}));
  const { opportunityId, goal, context } = body as { opportunityId?: string; goal?: string; context?: Record<string, unknown> };
  if (!opportunityId && !goal) return NextResponse.json({ error: "opportunityId or goal required" }, { status: 400 });
  const agent = getAgent("VENTURE")!;
  const result = await agent.execute({
    goal: goal ?? `venture analysis for ${opportunityId}`,
    context: { ...(opportunityId ? { opportunityId } : {}), ...(context ?? {}) },
  });
  if (result.status !== "SUCCESS") return NextResponse.json({ error: result.error ?? result.summary }, { status: 500 });
  return NextResponse.json({ analysis: result.output, executionId: result.executionId });
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }
