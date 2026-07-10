import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import { db } from "@/lib/db";

// GET /api/genesis/activity?limit=
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Number(searchParams.get("limit") ?? 50);
  const activity = await db.activityLog.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
  });
  return NextResponse.json({ activity });
}

// POST — push a new activity entry (used by websocket mini-service & UI actions)
export async function POST(req: NextRequest) {
  const _a = await guardWrite(req, "MEMBER"); if (!_a.ok) return _a.res;
  const body = await req.json();
  const created = await db.activityLog.create({
    data: {
      agent: body.agent,
      action: body.action,
      detail: body.detail,
      level: body.level ?? "INFO",
      category: body.category ?? "SYSTEM",
      taskId: body.taskId ?? null,
    },
  });
  return NextResponse.json({ activity: created });
}
