import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import { db } from "@/lib/db";
import { getAgent } from "@/lib/genesis/agent-runtime/agents";

/** GET /api/genesis/acquisition — the experiment memory.
 *  ?subject=OPP-000001  ?kind=PRICING|AUDIENCE|CHANNEL  ?limit=50
 *  Returns experiments with learnings, honesty labels (dataSource), and next actions.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const subject = searchParams.get("subject") ?? undefined;
  const kind = searchParams.get("kind") ?? undefined;
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);
  const experiments = await db.growthExperiment.findMany({
    where: { experimentId: { not: null }, ...(subject ? { subject } : {}), ...(kind ? { kind } : {}) },
    orderBy: { createdAt: "desc" }, take: limit,
  });
  return NextResponse.json({
    experiments: experiments.map((e) => ({ ...e, result: safeParse(e.result) })),
    learnings: experiments.filter((e) => e.learning).map((e) => ({ experimentId: e.experimentId, kind: e.kind, dataSource: e.dataSource, learning: e.learning })),
  });
}

/** POST /api/genesis/acquisition — run ONE acquisition cycle (hypothesis → experiment → measure → learn).
 *  body: { opportunityId? , subject?, context? }  — one of opportunityId | subject required.
 */
export async function POST(req: NextRequest) {
  const _a = await guardWrite(req, "MEMBER"); if (!_a.ok) return _a.res;
  const body = await req.json().catch(() => ({}));
  const { opportunityId, subject, context } = body as { opportunityId?: string; subject?: string; context?: Record<string, unknown> };
  if (!opportunityId && !subject) return NextResponse.json({ error: "opportunityId or subject required" }, { status: 400 });
  const result = await getAgent("ACQUISITION")!.execute({
    goal: `acquisition cycle: ${opportunityId ?? subject}`,
    context: { ...(opportunityId ? { opportunityId } : { subject }), ...(context ?? {}) },
  });
  if (result.status !== "SUCCESS") return NextResponse.json({ error: result.error ?? result.summary }, { status: 500 });
  return NextResponse.json({ cycle: result.output, executionId: result.executionId });
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }
