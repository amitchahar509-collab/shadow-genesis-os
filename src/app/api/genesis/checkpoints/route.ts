import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const checkpoints = await db.buildCheckpoint.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ checkpoints });
}
