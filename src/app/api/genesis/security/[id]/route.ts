import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const statusMap: Record<string, string> = { acknowledge: "ACKNOWLEDGED", fix: "FIXED", "false-positive": "FALSE_POSITIVE" };
  const newStatus = statusMap[body.action];
  if (!newStatus) return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 });
  const updated = await db.securityFinding.update({ where: { id }, data: { status: newStatus, resolvedAt: new Date() } });
  return NextResponse.json({ finding: updated });
}
