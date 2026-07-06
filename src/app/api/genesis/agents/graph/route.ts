import { NextResponse } from "next/server";
import { getCollaborationGraph, ALL_AGENTS } from "@/lib/genesis/agent-runtime/collab";
export async function GET() {
  const g = getCollaborationGraph();
  const nodes = ALL_AGENTS.map((a) => ({ id: a, label: a, outgoing: g.getOutgoing(a) }));
  return NextResponse.json({ nodes, agents: ALL_AGENTS });
}
