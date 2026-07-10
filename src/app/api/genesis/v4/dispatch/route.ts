import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import { dispatchGoal, startMission } from "@/lib/genesis/agent-runtime/orchestrator";
/** POST /api/genesis/v4/dispatch — "Build my idea" entry point.
 * body: { goal, projectId?, background? }
 * Runs the full V4 pipeline: CEO → RESEARCH → OPPORTUNITY → BUSINESS_VALIDATION → ARCHITECT → ENGINEERING → QUALITY → SECURITY → DEPLOYMENT → GROWTH → REVENUE.
 */
export async function POST(req: NextRequest) {
  const _a = await guardWrite(req, "ADMIN"); if (!_a.ok) return _a.res;
  const body = await req.json();
  const { goal, projectId, background } = body;
  if (!goal) return NextResponse.json({ error: "goal required" }, { status: 400 });
  if (background !== false) {
    const handle = startMission(goal, projectId);
    return NextResponse.json({ mission: handle, pipeline: "CEO → RESEARCH → OPPORTUNITY → VALIDATION → ARCHITECT → ENGINEERING → QUALITY → SECURITY → DEPLOYMENT → GROWTH → REVENUE" });
  }
  try { const result = await dispatchGoal(goal, { projectId }); return NextResponse.json({ result }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
