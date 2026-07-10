import { NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import { getStateManager } from "@/lib/genesis/agent-runtime/collab";
export async function GET() { const agents = await getStateManager().snapshot(); return NextResponse.json({ agents }); }
export async function PATCH(req: Request) {
  const _a = await guardWrite(req, "ADMIN"); if (!_a.ok) return _a.res;
  const { agent, action } = await req.json() as { agent: string; action: "pause" | "resume" };
  if (action === "pause") await getStateManager().pause(agent);
  else if (action === "resume") await getStateManager().resume(agent);
  else return NextResponse.json({ error: "action must be pause or resume" }, { status: 400 });
  return NextResponse.json({ agents: await getStateManager().snapshot() });
}
