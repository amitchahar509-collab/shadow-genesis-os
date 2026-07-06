import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { humanStatus } = await req.json() as { humanStatus: "APPROVED" | "REJECTED" };
  if (!["APPROVED", "REJECTED"].includes(humanStatus)) return NextResponse.json({ error: "humanStatus must be APPROVED or REJECTED" }, { status: 400 });
  const updated = await db.agentDecision.update({ where: { id }, data: { humanStatus, decidedAt: new Date() } });
  return NextResponse.json({ decision: updated });
}
