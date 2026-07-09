import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runCompetition } from "@/lib/genesis/agent-runtime/arena";
import { guard, audit } from "@/lib/genesis/agent-runtime/auth";

/** GET /api/genesis/arena — competitions with their scored team entries.
 *  ?limit=20  ?id=ARENA-000001 (with entries)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id") ?? undefined;
  if (id) {
    const comp = await db.arenaCompetition.findUnique({ where: { competitionId: id }, include: { entries: { orderBy: { rank: "asc" } } } });
    if (!comp) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ competition: { ...comp, entries: comp.entries.map((e) => ({ ...e, strategy: safeParse(e.strategy), scoreBreakdown: safeParse(e.scoreBreakdown) })) } });
  }
  const limit = Math.min(Number(searchParams.get("limit")) || 20, 100);
  const comps = await db.arenaCompetition.findMany({ orderBy: { createdAt: "desc" }, take: limit, include: { entries: { orderBy: { rank: "asc" } } } });
  return NextResponse.json({ competitions: comps.map((c) => ({ ...c, entries: c.entries.map((e) => ({ ...e, scoreBreakdown: safeParse(e.scoreBreakdown) })) })) });
}

/** POST /api/genesis/arena — run a competition (3 teams + judge; heavy real execution).
 *  body: { mission, opportunityId?, background?, potentialValue?, difficulty?, competition?, price? }
 */
export async function POST(req: NextRequest) {
  const g = await guard(req.headers.get("authorization"), "ADMIN");
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  const body = await req.json().catch(() => ({}));
  const { mission, opportunityId, background, potentialValue, difficulty, competition, price } = body as {
    mission?: string; opportunityId?: string; background?: boolean; potentialValue?: number; difficulty?: number; competition?: number; price?: number;
  };
  if (!mission && !opportunityId) return NextResponse.json({ error: "mission or opportunityId required" }, { status: 400 });
  const opts = { mission: mission ?? `competition for ${opportunityId}`, opportunityId, potentialValue, difficulty, competition, price };
  await audit(g.principal, "ARENA_RUN", opportunityId ?? mission);
  if (background ?? true) {
    runCompetition(opts).catch(() => {});
    return NextResponse.json({ accepted: true, note: "competition started; poll GET /api/genesis/arena" });
  }
  try {
    return NextResponse.json({ result: await runCompetition(opts) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }
