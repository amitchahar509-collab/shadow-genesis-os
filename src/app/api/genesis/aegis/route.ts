import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import { db } from "@/lib/db";
import { assertClaim, verifySubject, type EvidenceInput } from "@/lib/genesis/agent-runtime/aegis";

/** GET /api/genesis/aegis — claim registry / evidence graph.
 *  ?subject=OPP-000001  → verification summary for a subject
 *  ?verdict=UNSUPPORTED  ?limit=20  → list claims (with evidence)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const subject = searchParams.get("subject") ?? undefined;
  if (subject && searchParams.get("verify")) {
    return NextResponse.json({ verification: await verifySubject(subject) });
  }
  const limit = Math.min(Number(searchParams.get("limit")) || 20, 100);
  const verdict = searchParams.get("verdict") ?? undefined;
  const claims = await db.claim.findMany({
    where: { ...(subject ? { subject } : {}), ...(verdict ? { verdict } : {}) },
    orderBy: { createdAt: "desc" }, take: limit,
    include: { evidence: { orderBy: { createdAt: "asc" } } },
  });
  return NextResponse.json({ claims: claims.map((c) => ({ ...c, unknowns: safeParse(c.unknowns) })) });
}

/** POST /api/genesis/aegis — assert a claim with evidence; returns its truth score.
 *  body: { statement, subject?, category?, source?, evidence: [{stance, summary, source, sourceType?, weight?}], unknowns? }
 */
export async function POST(req: NextRequest) {
  const _a = await guardWrite(req, "MEMBER"); if (!_a.ok) return _a.res;
  const body = await req.json().catch(() => ({}));
  const { statement, subject, category, source, evidence, unknowns } = body as {
    statement?: string; subject?: string; category?: string; source?: string; evidence?: EvidenceInput[]; unknowns?: string[];
  };
  if (!statement) return NextResponse.json({ error: "statement required" }, { status: 400 });
  try {
    const truth = await assertClaim({ statement, subject, category: category as never, source, evidence, unknowns });
    return NextResponse.json({ truth });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }
