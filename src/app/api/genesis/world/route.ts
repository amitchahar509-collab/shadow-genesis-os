import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { scanWorld, promoteToOpportunity, connectorHealth } from "@/lib/genesis/agent-runtime/world-scanner";
import { guard, audit } from "@/lib/genesis/agent-runtime/auth";

/** GET /api/genesis/world — discovered problems (the WORLD_PROBLEM_GRAPH).
 *  ?dataSource=REALITY|MARKET_GAP|FAILED_VENTURE|WEB  ?status=DISCOVERED|PROMOTED  ?limit=30
 *  ?connectors=1 → live-internet connector health (V10 Module 1)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.has("connectors")) return NextResponse.json({ connectors: connectorHealth() });
  const dataSource = searchParams.get("dataSource") ?? undefined;
  const status = searchParams.get("status") ?? undefined;
  const limit = Math.min(Number(searchParams.get("limit")) || 30, 100);
  const problems = await db.worldProblem.findMany({ where: { ...(dataSource ? { dataSource } : {}), ...(status ? { status } : {}) }, orderBy: { opportunityScore: "desc" }, take: limit });
  return NextResponse.json({ problems: problems.map((p) => ({ ...p, currentAlternatives: safeParse(p.currentAlternatives), evidence: safeParse(p.evidence) })) });
}

/** POST /api/genesis/world — scan for problems, or promote one into the pipeline.
 *  { action: "scan", focus?, limit? }  → discover problems from real accumulated intelligence
 *  { action: "promote", problemId }    → create an Opportunity from a discovered problem
 */
export async function POST(req: NextRequest) {
  const g = await guard(req.headers.get("authorization"), "MEMBER");
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  const body = await req.json().catch(() => ({}));
  const { action, focus, limit, problemId } = body as { action?: string; focus?: string; limit?: number; problemId?: string };

  if (action === "promote") {
    if (!problemId) return NextResponse.json({ error: "problemId required" }, { status: 400 });
    const r = await promoteToOpportunity(problemId);
    if (!r) return NextResponse.json({ error: "problem not found" }, { status: 404 });
    await audit(g.principal, "WORLD_PROMOTE", problemId, r.opportunityId);
    return NextResponse.json(r);
  }
  // default: scan
  const result = await scanWorld({ focus, limit });
  await audit(g.principal, "WORLD_SCAN", `${result.problems.length} problems`);
  return NextResponse.json({ result });
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }
