import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import { runArchitecture } from "@/lib/genesis/agent-runtime/architecture";
import { runRequirements, type RequirementsDoc } from "@/lib/genesis/agent-runtime/requirements";
import { db } from "@/lib/db";

/** GET /api/genesis/architecture — recent architecture specs (open read). */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("archId");
  if (id) {
    const row = await db.architectureSpec.findUnique({ where: { archId: id } });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ arch: { ...row, doc: safeParse(row.doc) } });
  }
  const rows = await db.architectureSpec.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(Number(searchParams.get("limit")) || 20, 100) });
  return NextResponse.json({ archs: rows.map((r) => ({ archId: r.archId, specId: r.specId, goal: r.goal, mode: r.mode, summary: r.summary, moduleCount: r.moduleCount, createdAt: r.createdAt })) });
}

/** POST /api/genesis/architecture — derive an architecture from requirements.
 *  body: { specId } to use a stored RequirementSpec, or { goal } to derive
 *  requirements first (Phase 1 → Phase 2). Reasoning-driven, not a template. */
export async function POST(req: NextRequest) {
  const g = await guardWrite(req, "MEMBER"); if (!g.ok) return g.res;
  const body = await req.json().catch(() => ({}));
  try {
    let requirements: RequirementsDoc | null = null;
    let specId: string | undefined = typeof body.specId === "string" ? body.specId : undefined;

    if (specId) {
      const row = await db.requirementSpec.findUnique({ where: { specId } });
      if (!row) return NextResponse.json({ error: `requirement spec ${specId} not found` }, { status: 404 });
      requirements = safeParse(row.doc) as RequirementsDoc;
    } else if (typeof body.goal === "string" && body.goal.trim()) {
      const derived = await runRequirements(body.goal.trim(), { projectId: body.projectId });
      requirements = derived.doc; specId = derived.specId;
    } else {
      return NextResponse.json({ error: "specId or goal required" }, { status: 400 });
    }

    const { archId, doc } = await runArchitecture(requirements, { specId, projectId: body.projectId });
    return NextResponse.json({ archId, specId, doc });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }
