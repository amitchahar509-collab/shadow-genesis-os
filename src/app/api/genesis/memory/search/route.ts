import { NextRequest, NextResponse } from "next/server";
import { getMemoryEngine } from "@/lib/genesis/agent-runtime/memory/engine";
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const agent = searchParams.get("agent");
  const goal = searchParams.get("goal");
  const limit = Number(searchParams.get("limit") ?? 8);
  const tags = searchParams.get("tags")?.split(",").filter(Boolean) ?? [];
  const engine = getMemoryEngine();
  if (agent && goal) { const results = await engine.relevant({ agent, goal, limit }); return NextResponse.json({ results, count: results.length, mode: "relevant" }); }
  const results = await engine.recall({ query: q, tags, limit });
  return NextResponse.json({ results, count: results.length, mode: "recall" });
}
