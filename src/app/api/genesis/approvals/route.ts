import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requestApproval, decide, expireStale, type ActionType } from "@/lib/genesis/agent-runtime/approvals";

/** GET /api/genesis/approvals — the human control center queue.
 *  ?status=PENDING|APPROVED|REJECTED|EXECUTED|EXPIRED  ?limit=50  ?id=APR-000001
 */
export async function GET(req: NextRequest) {
  await expireStale().catch(() => 0); // lazily sweep stale PENDING rows on every read
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id") ?? undefined;
  if (id) {
    const row = await db.approvalRequest.findUnique({ where: { requestId: id } });
    if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ request: hydrate(row) });
  }
  const status = searchParams.get("status") ?? undefined;
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);
  const rows = await db.approvalRequest.findMany({ where: status ? { status } : undefined, orderBy: { requestedAt: "desc" }, take: limit });
  const pending = await db.approvalRequest.count({ where: { status: "PENDING" } });
  return NextResponse.json({ pending, requests: rows.map(hydrate) });
}

/** POST /api/genesis/approvals — manually enqueue an approval request.
 *  body: { agent, actionType, description, payload? }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { agent, actionType, description, payload } = body as { agent?: string; actionType?: ActionType; description?: string; payload?: Record<string, unknown> };
  if (!agent || !actionType || !description) return NextResponse.json({ error: "agent, actionType, description required" }, { status: 400 });
  const request = await requestApproval({ agent, actionType, description, payload });
  return NextResponse.json({ request });
}

/** PATCH /api/genesis/approvals — human decision.
 *  body: { requestId, approve: boolean, decidedBy, note? }
 */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { requestId, approve, decidedBy, note } = body as { requestId?: string; approve?: boolean; decidedBy?: string; note?: string };
  if (!requestId || typeof approve !== "boolean" || !decidedBy) return NextResponse.json({ error: "requestId, approve, decidedBy required" }, { status: 400 });
  const result = await decide(requestId, { approve, decidedBy, note });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ requestId, status: result.status });
}

function hydrate(r: { payload: string; riskFactors: string } & Record<string, unknown>) {
  return { ...r, payload: safeParse(r.payload), riskFactors: safeParse(r.riskFactors) };
}
function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }
