import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createCompany } from "@/lib/genesis/agent-runtime/pipeline/company";

/** GET /api/genesis/company — venture pipeline runs.
 *  ?limit=20  ?status=BUILT|PLANNED|HALTED_NO_GO|FAILED  ?id=RUN-000001
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id") ?? undefined;
  if (id) {
    const run = await db.ventureRun.findUnique({ where: { runId: id } });
    if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ run: { ...run, stages: safeParse(run.stages) } });
  }
  const limit = Math.min(Number(searchParams.get("limit")) || 20, 100);
  const status = searchParams.get("status") ?? undefined;
  const runs = await db.ventureRun.findMany({ where: status ? { status } : undefined, orderBy: { createdAt: "desc" }, take: limit });
  return NextResponse.json({ runs: runs.map((r) => ({ ...r, stages: safeParse(r.stages) })) });
}

/** POST /api/genesis/company — "create a company" (no idea required).
 *  body: { focus?, opportunityId?, personaCount?, build?, background? }
 *  background (default true when build) returns a runId immediately; poll GET ?id=.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { focus, opportunityId, personaCount, build, background, projectId } = body as {
    focus?: string; opportunityId?: string; personaCount?: number; build?: boolean; background?: boolean; projectId?: string;
  };
  const opts = { focus, opportunityId, personaCount, build, projectId };
  // A full build can take minutes — default to background for build runs.
  if (background ?? build !== false) {
    const promise = createCompany(opts);
    // Fire-and-forget; progress is persisted in VentureRun as it advances.
    promise.catch(() => {});
    return NextResponse.json({ accepted: true, note: "run started; poll GET /api/genesis/company for status", pipeline: "DISCOVER → AEGIS → VENTURE → CUSTOMER → BOARD → BUILD" });
  }
  try {
    const run = await createCompany(opts);
    return NextResponse.json({ run });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }
