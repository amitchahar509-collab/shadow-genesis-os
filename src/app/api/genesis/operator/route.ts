import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { startLongMission, tick, tickAll } from "@/lib/genesis/agent-runtime/operator";
import { guard, audit } from "@/lib/genesis/agent-runtime/auth";

/** GET /api/genesis/operator — long-horizon missions.
 *  ?status=ACTIVE|PAUSED|COMPLETED|KILLED  ?limit=20  ?id=LM-000001 (with reviews)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id") ?? undefined;
  if (id) {
    const mission = await db.longMission.findUnique({ where: { missionId: id }, include: { reviews: { orderBy: { createdAt: "asc" } } } });
    if (!mission) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ mission: { ...mission, metrics: safeParse(mission.metrics), reviews: mission.reviews.map((r) => ({ ...r, findings: safeParse(r.findings), actions: safeParse(r.actions), metrics: safeParse(r.metrics) })) } });
  }
  const status = searchParams.get("status") ?? undefined;
  const limit = Math.min(Number(searchParams.get("limit")) || 20, 100);
  const missions = await db.longMission.findMany({ where: status ? { status } : undefined, orderBy: { createdAt: "desc" }, take: limit });
  return NextResponse.json({ missions: missions.map((m) => ({ ...m, metrics: safeParse(m.metrics) })) });
}

/** POST /api/genesis/operator — start a mission.
 *  body: { goal, companyKey?, opportunityId?, horizonDays? (30|60|90) }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { goal, companyKey, opportunityId, horizonDays } = body as { goal?: string; companyKey?: string; opportunityId?: string; horizonDays?: 30 | 60 | 90 };
  if (!goal) return NextResponse.json({ error: "goal required" }, { status: 400 });
  if (horizonDays !== undefined && ![30, 60, 90].includes(horizonDays)) return NextResponse.json({ error: "horizonDays must be 30, 60, or 90" }, { status: 400 });
  const mission = await startLongMission({ goal, companyKey, opportunityId, horizonDays });
  return NextResponse.json({ mission });
}

/** PATCH /api/genesis/operator — advance or control missions.
 *  body: { action: "tick" | "tickAll" | "pause" | "resume", missionId?, now? (ISO, simulation only — recorded as asOf) }
 */
export async function PATCH(req: NextRequest) {
  const g = await guard(req.headers.get("authorization"), "ADMIN");
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  const body = await req.json().catch(() => ({}));
  const { action, missionId, now } = body as { action?: string; missionId?: string; now?: string };
  const asOf = now ? new Date(now) : undefined;
  if (asOf && Number.isNaN(asOf.getTime())) return NextResponse.json({ error: "invalid now" }, { status: 400 });
  await audit(g.principal, "OPERATOR_TICK", missionId ?? action ?? "?", String(action));

  if (action === "tickAll") return NextResponse.json({ results: await tickAll({ now: asOf }) });
  if (!missionId) return NextResponse.json({ error: "missionId required" }, { status: 400 });
  if (action === "tick") return NextResponse.json({ result: await tick(missionId, { now: asOf }) });
  if (action === "pause" || action === "resume") {
    const target = action === "pause" ? "PAUSED" : "ACTIVE";
    const from = action === "pause" ? "ACTIVE" : "PAUSED";
    const { count } = await db.longMission.updateMany({ where: { missionId, status: from }, data: { status: target } });
    if (count === 0) return NextResponse.json({ error: `mission not in ${from} state` }, { status: 400 });
    return NextResponse.json({ missionId, status: target });
  }
  return NextResponse.json({ error: "action must be tick | tickAll | pause | resume" }, { status: 400 });
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }
