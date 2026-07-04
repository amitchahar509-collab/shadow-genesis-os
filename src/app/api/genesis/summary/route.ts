import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/genesis/summary — aggregated command-center payload in one call.
export async function GET() {
  const [stateRows, departments, metrics, loops, tasks, recentActivity, decisions, checkpoints] =
    await Promise.all([
      db.genesisState.findMany(),
      db.department.findMany({ orderBy: { key: "asc" } }),
      db.systemMetric.findMany({ orderBy: { name: "asc" } }),
      db.operationalLoop.findMany({ orderBy: { key: "asc" } }),
      db.genesisTask.findMany({ orderBy: { taskId: "asc" } }),
      db.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
      db.ceoDecision.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
      db.buildCheckpoint.findMany({ orderBy: { createdAt: "desc" }, take: 6 }),
    ]);

  const state: Record<string, string> = {};
  for (const r of stateRows) state[r.key] = r.value;

  const statusCounts: Record<string, number> = {};
  const priorityCounts: Record<string, number> = {};
  for (const t of tasks) {
    statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1;
    priorityCounts[t.priority] = (priorityCounts[t.priority] ?? 0) + 1;
  }

  return NextResponse.json({
    state,
    departments,
    metrics,
    loops,
    tasks,
    recentActivity,
    decisions,
    checkpoints,
    statusCounts,
    priorityCounts,
  });
}
