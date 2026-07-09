import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ingestSignal, processPending, type SignalKind } from "@/lib/genesis/agent-runtime/reality-feedback";

/** GET /api/genesis/feedback — reality signals and what they generated.
 *  ?subject=OPP-000001  ?kind=ERROR|FEEDBACK|FEATURE_REQUEST|USAGE|RETENTION|CONVERSION
 *  ?actedOn=false  ?limit=50
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const subject = searchParams.get("subject") ?? undefined;
  const kind = searchParams.get("kind") ?? undefined;
  const actedOn = searchParams.get("actedOn");
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);
  const signals = await db.realitySignal.findMany({
    where: { signalId: { not: null }, ...(subject ? { subject } : {}), ...(kind ? { kind } : {}), ...(actedOn !== null ? { actedOn: actedOn === "true" } : {}) },
    orderBy: { createdAt: "desc" }, take: limit,
  });
  const pending = await db.realitySignal.count({ where: { signalId: { not: null }, actedOn: false } });
  return NextResponse.json({ pending, signals: signals.map((s) => ({ ...s, payload: safeParse(s.payload), generated: safeParse(s.generated) })) });
}

/** POST /api/genesis/feedback — a deployed product reports REAL telemetry; Genesis reacts.
 *  body: { kind, productKey, source, detail, subject?, sentiment?, payload? }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { kind, productKey, source, detail, subject, sentiment, payload, projectId } = body as {
    kind?: SignalKind; productKey?: string; source?: string; detail?: string; subject?: string; sentiment?: number; payload?: Record<string, unknown>; projectId?: string;
  };
  const KINDS = ["ERROR", "FEEDBACK", "FEATURE_REQUEST", "USAGE", "RETENTION", "CONVERSION"];
  if (!kind || !KINDS.includes(kind)) return NextResponse.json({ error: `kind must be one of ${KINDS.join(", ")}` }, { status: 400 });
  if (!productKey || !source || !detail) return NextResponse.json({ error: "productKey, source, detail required" }, { status: 400 });
  try {
    const result = await ingestSignal({ kind, productKey, source, detail, subject, sentiment, payload, projectId });
    return NextResponse.json({ result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** PATCH /api/genesis/feedback — re-process any signals that failed to act. */
export async function PATCH() {
  return NextResponse.json({ processed: await processPending() });
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }
