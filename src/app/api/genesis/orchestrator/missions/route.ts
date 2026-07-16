import { NextResponse } from "next/server";
import { listMissions } from "@/lib/genesis/agent-runtime/orchestrator";
import { db } from "@/lib/db";
import { workspaceRoot } from "@/lib/genesis/agent-runtime/workspace";

/** GET /api/genesis/orchestrator/missions — missions with LIVE per-task progress
 *  for running ones, plus the concrete OUTPUTS of every mission that produced
 *  them (generated repo path + local deploy URL) so a user can actually find and
 *  open the app a mission built — not just see "COMPLETE". */
export async function GET() {
  const missions = listMissions();
  const enriched = await Promise.all(
    missions.map(async (m) => {
      if (!m.taskIds?.length) return m;

      // Concrete artifacts (generated repo) + the local deploy URL for this mission.
      const [repos, deploy] = await Promise.all([
        db.artifact
          .findMany({ where: { taskId: { in: m.taskIds }, type: "REPOSITORY" }, orderBy: { createdAt: "desc" }, select: { path: true, description: true } })
          .catch(() => [] as { path: string; description: string }[]),
        db.deploymentRecord
          .findFirst({ where: { taskId: { in: m.taskIds }, url: { not: null } }, orderBy: { createdAt: "desc" }, select: { url: true, target: true, status: true, health: true } })
          .catch(() => null),
      ]);
      const outputs = {
        workspaceRoot: workspaceRoot(),
        repoPath: repos[0]?.path ?? null,
        repoPaths: repos.map((r) => r.path),
        deployUrl: deploy?.url ?? null,
        deployTarget: deploy?.target ?? null,
        deployStatus: deploy?.status ?? null,
        deployHealth: deploy?.health ?? null,
      };

      if (m.status !== "RUNNING") return { ...m, outputs };

      const tasks = await db.genesisTask.findMany({ where: { taskId: { in: m.taskIds } }, orderBy: { createdAt: "asc" }, select: { taskId: true, ownerAgent: true, title: true, status: true, progress: true } });
      const done = tasks.filter((t) => t.status === "DONE").length;
      const failed = tasks.filter((t) => t.status === "FAILED").length;
      const inProgress = tasks.filter((t) => t.status === "IN_PROGRESS" || t.status === "REVIEW").length;
      return { ...m, outputs, progress: { total: tasks.length, done, failed, inProgress, pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0, tasks } };
    }),
  );
  return NextResponse.json({ missions: enriched });
}
