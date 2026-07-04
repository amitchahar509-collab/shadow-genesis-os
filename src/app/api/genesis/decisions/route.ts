import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const decisions = await db.ceoDecision.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ decisions });
}

export async function POST(req: Request) {
  const body = await req.json();
  const created = await db.ceoDecision.create({
    data: {
      title: body.title,
      rationale: body.rationale,
      decision: body.decision,
      impact: body.impact ?? "MEDIUM",
      status: body.status ?? "PROPOSED",
    },
  });
  return NextResponse.json({ decision: created });
}
