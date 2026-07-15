import { NextResponse } from "next/server";
import { listMissions } from "@/lib/genesis/agent-runtime/orchestrator";
import { db } from "@/lib/db";

/** GET /api/genesis/orchestrator/missions — missions with LIVE per-task progress
 *  for running ones (so the Missions UI shows real progress, not a dead list). */
export async function GET() {
  const missions = listMissions();
  const enriched = await Promise.all(missions.map(async (m) => {
    if (m.status !== "RUNNING" || !m.taskIds?.length) return m;
    const tasks = await db.genesisTask.findMany({ where: { taskId: { in: m.taskIds } }, orderBy: { createdAt: "asc" }, select: { taskId: true, ownerAgent: true, title: true, status: true, progress: true } });
    const done = tasks.filter((t) => t.status === "DONE").length;
    const failed = tasks.filter((t) => t.status === "FAILED").length;
    const inProgress = tasks.filter((t) => t.status === "IN_PROGRESS" || t.status === "REVIEW").length;
    return { ...m, progress: { total: tasks.length, done, failed, inProgress, pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0, tasks } };
  }));
  return NextResponse.json({ missions: enriched });
}
