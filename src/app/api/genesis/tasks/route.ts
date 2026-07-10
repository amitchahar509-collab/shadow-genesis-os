import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import { db } from "@/lib/db";

// GET /api/genesis/tasks?status=&priority=&department=&q=
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const priority = searchParams.get("priority");
  const department = searchParams.get("department");
  const q = searchParams.get("q");

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (department) where.department = department;
  if (q) {
    where.OR = [
      { title: { contains: q } },
      { taskId: { contains: q } },
      { description: { contains: q } },
    ];
  }

  const tasks = await db.genesisTask.findMany({
    where,
    orderBy: { taskId: "asc" },
  });
  return NextResponse.json({ tasks });
}

// POST /api/genesis/tasks — create a new task
export async function POST(req: NextRequest) {
  const _a = await guardWrite(req, "MEMBER"); if (!_a.ok) return _a.res;
  const body = await req.json();
  const created = await db.genesisTask.create({
    data: {
      taskId: body.taskId,
      title: body.title,
      description: body.description ?? "",
      ownerAgent: body.ownerAgent,
      department: body.department,
      priority: body.priority ?? "MEDIUM",
      status: body.status ?? "PENDING",
      progress: body.progress ?? 0,
      dependencies: body.dependencies ?? "[]",
      expectedArtifact: body.expectedArtifact ?? "",
      validation: body.validation ?? "",
      estimatedHours: body.estimatedHours ?? 0,
    },
  });
  return NextResponse.json({ task: created });
}

// PATCH /api/genesis/tasks — update a task (status / progress)
export async function PATCH(req: NextRequest) {
  const _a = await guardWrite(req, "MEMBER"); if (!_a.ok) return _a.res;
  const body = await req.json();
  const { id, ...rest } = body;
  const data: Record<string, unknown> = { ...rest };
  if (rest.status === "IN_PROGRESS" && !rest.startedAt) data.startedAt = new Date();
  if (rest.status === "DONE" && !rest.completedAt) data.completedAt = new Date();
  const updated = await db.genesisTask.update({
    where: { id },
    data,
  });
  return NextResponse.json({ task: updated });
}
