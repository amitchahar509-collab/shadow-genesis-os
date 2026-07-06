import { NextRequest, NextResponse } from "next/server";
import { getActivePrompt, setPrompt, listVersions } from "@/lib/genesis/agent-runtime/improvement/prompts";
export async function GET(req: NextRequest) {
  const agent = new URL(req.url).searchParams.get("agent");
  if (!agent) return NextResponse.json({ error: "agent required" }, { status: 400 });
  const versions = await listVersions(agent);
  const active = await getActivePrompt(agent);
  return NextResponse.json({ versions, active });
}
export async function POST(req: NextRequest) {
  const { agent, systemPrompt, notes } = await req.json();
  if (!agent || !systemPrompt) return NextResponse.json({ error: "agent + systemPrompt required" }, { status: 400 });
  const p = await setPrompt(agent, systemPrompt, notes);
  return NextResponse.json({ prompt: p });
}
