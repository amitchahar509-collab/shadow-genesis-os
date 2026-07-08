import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conveneBoard, BOARD } from "@/lib/genesis/agent-runtime/boardroom";

/** GET /api/genesis/boardroom — recent board decisions with their arguments.
 *  Query: ?limit=20  ?verdict=GO|CONDITIONAL|NO_GO  ?seats=1 (just list the seats)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("seats")) {
    return NextResponse.json({ seats: BOARD.map((b) => ({ role: b.role, title: b.title, charter: b.charter, bias: b.bias })) });
  }
  const limit = Math.min(Number(searchParams.get("limit")) || 20, 100);
  const verdict = searchParams.get("verdict") ?? undefined;
  const decisions = await db.boardDecision.findMany({
    where: verdict ? { verdict } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { arguments: { orderBy: { createdAt: "asc" } } },
  });
  return NextResponse.json({
    decisions: decisions.map((d) => ({
      ...d,
      context: safeParse(d.context),
      tally: safeParse(d.tally),
      conditions: safeParse(d.conditions),
      risks: safeParse(d.risks),
      arguments: d.arguments.map((a) => ({ ...a, concerns: safeParse(a.concerns) })),
    })),
  });
}

/** POST /api/genesis/boardroom — convene the board on an ad-hoc decision (synchronous).
 *  body: { question, topic?, context?, projectId?, missionId? }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { question, topic, context, projectId, missionId } = body as {
    question?: string; topic?: string; context?: Record<string, unknown>; projectId?: string; missionId?: string;
  };
  if (!question) return NextResponse.json({ error: "question required" }, { status: 400 });
  try {
    const decision = await conveneBoard({ question, topic: topic ?? question.slice(0, 120), context, projectId, missionId });
    return NextResponse.json({ decision });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }
