import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import { dispatchGoal, startMission } from "@/lib/genesis/agent-runtime/orchestrator";
export async function POST(req: NextRequest) {
  const _a = await guardWrite(req, "ADMIN"); if (!_a.ok) return _a.res;
  const body = await req.json();
  const { goal, skipCeo, taskIds, projectId, background } = body;
  if (!goal && !taskIds?.length) return NextResponse.json({ error: "goal (or taskIds[]) required" }, { status: 400 });
  if (background !== false) {
    const handle = startMission(goal ?? "(taskIds provided)", projectId);
    return NextResponse.json({ mission: handle, note: "running in background — poll /api/genesis/orchestrator/missions for status" });
  }
  try { const result = await dispatchGoal(goal ?? "(taskIds provided)", { skipCeo, taskIds, projectId }); return NextResponse.json({ result }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
