import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const reports = await db.researchReport.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ reports });
}
