import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const departments = await db.department.findMany({ orderBy: { key: "asc" } });
  return NextResponse.json({ departments });
}
