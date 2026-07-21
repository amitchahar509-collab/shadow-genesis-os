import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import { runRequirements } from "@/lib/genesis/agent-runtime/requirements";
import { db } from "@/lib/db";

/** GET /api/genesis/requirements — recent requirement specs (open read). */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("specId");
  if (id) {
    const row = await db.requirementSpec.findUnique({ where: { specId: id } });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ spec: { ...row, doc: safeParse(row.doc) } });
  }
  const rows = await db.requirementSpec.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(Number(searchParams.get("limit")) || 20, 100) });
  return NextResponse.json({ specs: rows.map((r) => ({ specId: r.specId, goal: r.goal, mode: r.mode, purpose: r.purpose, entityCount: r.entityCount, featureCount: r.featureCount, createdAt: r.createdAt })) });
}

/** POST /api/genesis/requirements — { goal } → derive + persist a requirements doc.
 *  V11 Phase 1: reasoning-driven, goal-specific; NOT a template. */
export async function POST(req: NextRequest) {
  const g = await guardWrite(req, "MEMBER"); if (!g.ok) return g.res;
  const body = await req.json().catch(() => ({}));
  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  if (!goal) return NextResponse.json({ error: "goal required" }, { status: 400 });
  try {
    const { specId, doc } = await runRequirements(goal, { projectId: body.projectId });
    return NextResponse.json({ specId, doc });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }
