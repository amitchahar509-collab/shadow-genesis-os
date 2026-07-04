import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const metrics = await db.systemMetric.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ metrics });
}
