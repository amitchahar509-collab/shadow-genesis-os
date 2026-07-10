import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import { db } from "@/lib/db";

export async function GET() {
  const loops = await db.operationalLoop.findMany({ orderBy: { key: "asc" } });
  return NextResponse.json({ loops });
}

// PATCH — toggle loop status (RUNNING / PAUSED)
export async function PATCH(req: NextRequest) {
  const _a = await guardWrite(req, "ADMIN"); if (!_a.ok) return _a.res;
  const body = await req.json();
  const { id, status } = body;
  const updated = await db.operationalLoop.update({
    where: { id },
    data: { status, lastRunAt: status === "RUNNING" ? new Date() : undefined },
  });
  return NextResponse.json({ loop: updated });
}
