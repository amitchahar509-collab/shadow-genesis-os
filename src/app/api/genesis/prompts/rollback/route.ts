import { NextRequest, NextResponse } from "next/server";
import { rollback } from "@/lib/genesis/agent-runtime/improvement/prompts";
export async function POST(req: NextRequest) {
  const { agent } = await req.json();
  if (!agent) return NextResponse.json({ error: "agent required" }, { status: 400 });
  const rolled = await rollback(agent);
  if (!rolled) return NextResponse.json({ error: "no previous version" }, { status: 404 });
  return NextResponse.json({ prompt: rolled });
}
