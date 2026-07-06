import { NextResponse } from "next/server";
import { getStateManager } from "@/lib/genesis/agent-runtime/collab";
export async function GET() { const agents = await getStateManager().snapshot(); return NextResponse.json({ agents }); }
export async function PATCH(req: Request) {
  const { agent, action } = await req.json() as { agent: string; action: "pause" | "resume" };
  if (action === "pause") await getStateManager().pause(agent);
  else if (action === "resume") await getStateManager().resume(agent);
  else return NextResponse.json({ error: "action must be pause or resume" }, { status: 400 });
  return NextResponse.json({ agents: await getStateManager().snapshot() });
}
