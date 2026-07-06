import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const severity = searchParams.get("severity");
  const status = searchParams.get("status");
  const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
  const where: Record<string, unknown> = {};
  if (severity) where.severity = severity;
  if (status) where.status = status;
  const findings = await db.securityFinding.findMany({ where, orderBy: { createdAt: "desc" }, take: limit });
  const bySeverity = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const f of findings) bySeverity[f.severity as keyof typeof bySeverity]++;
  return NextResponse.json({ findings, count: findings.length, bySeverity });
}
