import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { evolveAgent, evolveAll, evaluateAgent } from "@/lib/genesis/agent-runtime/evolution";
import { guard, audit } from "@/lib/genesis/agent-runtime/auth";

/** GET /api/genesis/evolution — evolution action history / an agent evaluation.
 *  ?agent=ENGINEERING  ?kind=IMPROVE_PROMPT  ?limit=50  ?evaluate=ENGINEERING (read-only eval)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const evaluate = searchParams.get("evaluate");
  if (evaluate) return NextResponse.json({ evaluation: await evaluateAgent(evaluate, Number(searchParams.get("windowHours")) || 168) });
  const agent = searchParams.get("agent") ?? undefined;
  const kind = searchParams.get("kind") ?? undefined;
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);
  const actions = await db.evolutionAction.findMany({ where: { ...(agent ? { agent: agent.toUpperCase() } : {}), ...(kind ? { kind } : {}) }, orderBy: { createdAt: "desc" }, take: limit });
  return NextResponse.json({ actions: actions.map((a) => ({ ...a, metrics: safeParse(a.metrics) })) });
}

/** PATCH /api/genesis/evolution — run evolution (applies prompt changes → ADMIN).
 *  body: { action: "evolveAll" | "evolveAgent", agent?, apply? (default: evolveAll dry-run, evolveAgent apply), windowHours? }
 */
export async function PATCH(req: NextRequest) {
  const g = await guard(req.headers.get("authorization"), "ADMIN");
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  const body = await req.json().catch(() => ({}));
  const { action, agent, apply, windowHours } = body as { action?: string; agent?: string; apply?: boolean; windowHours?: number };
  if (action === "evolveAll") {
    const results = await evolveAll({ apply: apply ?? false, windowHours });
    await audit(g.principal, "EVOLUTION_SWEEP", `${results.length} agents`, `applied ${results.filter((r) => r.applied).length}`);
    return NextResponse.json({ results });
  }
  if (action === "evolveAgent") {
    if (!agent) return NextResponse.json({ error: "agent required" }, { status: 400 });
    const result = await evolveAgent(agent, { apply: apply ?? true, windowHours });
    await audit(g.principal, "EVOLUTION_AGENT", agent, `${result.kind}${result.applied ? " (applied)" : ""}`);
    return NextResponse.json({ result });
  }
  return NextResponse.json({ error: "action must be 'evolveAll' or 'evolveAgent'" }, { status: 400 });
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }
