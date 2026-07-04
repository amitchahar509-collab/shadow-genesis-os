import { NextResponse } from "next/server";
import { seedGenesis } from "@/lib/genesis/seed";

// POST /api/genesis/seed — (re)seed the entire Genesis OS state. Idempotent.
export async function POST() {
  try {
    const result = await seedGenesis();
    return NextResponse.json(result);
  } catch (e) {
    console.error("[genesis/seed] failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "seed failed" },
      { status: 500 }
    );
  }
}

// GET — quick health + seed status
export async function GET() {
  return NextResponse.json({ ok: true, message: "Genesis seed endpoint. POST to (re)seed." });
}
