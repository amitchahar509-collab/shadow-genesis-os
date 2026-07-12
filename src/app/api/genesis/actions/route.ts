import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import {
  actionsOverview, connectorCatalog, verifyConnector, requestAction,
  decideAction, executeAction, retryAction, deadLetterQueue,
} from "@/lib/genesis/agent-runtime/action-connectors";

/** GET /api/genesis/actions — connector health + execution history.
 *  ?catalog=1  ?verify=<connector>  ?deadletter=1
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("catalog") === "1") return NextResponse.json({ connectors: connectorCatalog() });
  const v = searchParams.get("verify");
  if (v) return NextResponse.json(await verifyConnector(v));
  if (searchParams.get("deadletter") === "1") return NextResponse.json({ deadLetter: await deadLetterQueue() });
  return NextResponse.json(await actionsOverview());
}

/** POST /api/genesis/actions — { action, ... }. Every mutation is approval-gated.
 *  actions: request | decide | execute | retry
 */
export async function POST(req: NextRequest) {
  const g = await guardWrite(req, "MEMBER");
  if (!g.ok) return g.res;
  const b = await req.json().catch(() => ({}));
  const { action } = b as { action?: string };

  switch (action) {
    case "request": {
      if (!b.connector || !b.operation || !b.payload) return NextResponse.json({ error: "connector, operation, payload required" }, { status: 400 });
      const r = await requestAction({ connector: b.connector, operation: b.operation, companyKey: b.companyKey, workspace: b.workspace, agent: g.principal.userId, payload: b.payload, idempotencyKey: b.idempotencyKey });
      return NextResponse.json(r, { status: "error" in r ? (r.status ?? 400) : 200 });
    }
    case "decide": {
      if (!b.actionId || typeof b.approve !== "boolean") return NextResponse.json({ error: "actionId and approve required" }, { status: 400 });
      const r = await decideAction(String(b.actionId), { approve: b.approve, decidedBy: g.principal.userId, note: b.note });
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    case "execute": {
      if (!b.actionId) return NextResponse.json({ error: "actionId required" }, { status: 400 });
      const r = await executeAction(String(b.actionId));
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    case "retry": {
      if (!b.actionId) return NextResponse.json({ error: "actionId required" }, { status: 400 });
      const r = await retryAction(String(b.actionId));
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    default:
      return NextResponse.json({ error: "action must be request|decide|execute|retry" }, { status: 400 });
  }
}
