import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const rows = await db.genesisState.findMany();
  const state: Record<string, string> = {};
  for (const r of rows) state[r.key] = r.value;
  return NextResponse.json({ state });
}
