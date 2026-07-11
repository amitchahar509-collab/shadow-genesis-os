import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import {
  customerSuccessOverview, recordProductEvent, createTicket, updateTicket,
  behaviorAnalytics, dropOffFunnel, satisfaction, customerHealth, generateImprovementTasks,
  type EventType,
} from "@/lib/genesis/agent-runtime/customer-success";

/** GET /api/genesis/customer-success — CS overview (behavior, tickets, satisfaction).
 *  ?behavior=<productKey?>  ?funnel=<productKey>  ?health=<productKey>  ?satisfaction=<productKey?>
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.has("behavior")) return NextResponse.json(await behaviorAnalytics(searchParams.get("behavior") || undefined));
  const funnel = searchParams.get("funnel");
  if (funnel) return NextResponse.json(await dropOffFunnel(funnel));
  const health = searchParams.get("health");
  if (health) return NextResponse.json(await customerHealth(health));
  if (searchParams.has("satisfaction")) return NextResponse.json(await satisfaction(searchParams.get("satisfaction") || undefined));
  return NextResponse.json(await customerSuccessOverview());
}

/** POST /api/genesis/customer-success — { action, ... }. Real data only.
 *  actions: event | ticket | ticket-status | improvement-tasks
 */
export async function POST(req: NextRequest) {
  const g = await guardWrite(req, "MEMBER");
  if (!g.ok) return g.res;
  const b = await req.json().catch(() => ({}));
  const { action } = b as { action?: string };

  switch (action) {
    case "event": {
      if (!b.productKey || !b.eventType) return NextResponse.json({ error: "productKey and eventType required" }, { status: 400 });
      return NextResponse.json(await recordProductEvent({ productKey: b.productKey, eventType: b.eventType as EventType, userRef: b.userRef, feature: b.feature, sessionId: b.sessionId, value: b.value }));
    }
    case "ticket": {
      if (!b.productKey || !b.subject) return NextResponse.json({ error: "productKey and subject required" }, { status: 400 });
      return NextResponse.json(await createTicket({ productKey: b.productKey, subject: b.subject, body: b.body, category: b.category, priority: b.priority, userRef: b.userRef, source: b.source }));
    }
    case "ticket-status": {
      if (!b.ticketId || !b.status) return NextResponse.json({ error: "ticketId and status required" }, { status: 400 });
      const r = await updateTicket(String(b.ticketId), b.status);
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    case "improvement-tasks":
      return NextResponse.json(await generateImprovementTasks());
    default:
      return NextResponse.json({ error: "action must be event|ticket|ticket-status|improvement-tasks" }, { status: 400 });
  }
}
