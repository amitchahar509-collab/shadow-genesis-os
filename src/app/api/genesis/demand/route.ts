import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { analyzeDemand } from "@/lib/genesis/agent-runtime/demand";
import { guard, audit } from "@/lib/genesis/agent-runtime/auth";

/** GET /api/genesis/demand — product DNAs and demand matches.
 *  ?id=DM-000001 (a match)  ?dna=DNA-000001 (matches for a DNA)  ?limit=20
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id") ?? undefined;
  if (id) {
    const match = await db.demandMatch.findUnique({ where: { matchId: id } });
    if (!match) return NextResponse.json({ error: "not found" }, { status: 404 });
    const dna = await db.productDNA.findUnique({ where: { dnaId: match.dnaId } });
    return NextResponse.json({ match: { ...match, segments: safeParse(match.segments) }, dna: dna ? hydrateDna(dna) : null });
  }
  const limit = Math.min(Number(searchParams.get("limit")) || 20, 100);
  const dnaId = searchParams.get("dna") ?? undefined;
  const matches = await db.demandMatch.findMany({ where: dnaId ? { dnaId } : undefined, orderBy: { createdAt: "desc" }, take: limit });
  return NextResponse.json({ matches: matches.map((m) => ({ ...m, segments: safeParse(m.segments) })) });
}

/** POST /api/genesis/demand — fingerprint a product (Product DNA) + match it to demand (Customer Match).
 *  body: { opportunityId? , subject?, problem?, targetUsers?, features?, personaCount? }
 */
export async function POST(req: NextRequest) {
  const g = await guard(req.headers.get("authorization"), "MEMBER");
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  const body = await req.json().catch(() => ({}));
  const { opportunityId, subject, problem, targetUsers, features, personaCount } = body as {
    opportunityId?: string; subject?: string; problem?: string; targetUsers?: string; features?: string[]; personaCount?: number;
  };
  if (!opportunityId && !subject) return NextResponse.json({ error: "opportunityId or subject required" }, { status: 400 });
  try {
    const result = await analyzeDemand({ opportunityId, subject, problem, targetUsers, features, personaCount });
    await audit(g.principal, "DEMAND_MATCH", result.dna.dnaId, `${result.match.demandScore}/100 top ${result.match.topSegment}`);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

function hydrateDna(d: { features: string; alternatives: string; keywords: string } & Record<string, unknown>) {
  return { ...d, features: safeParse(d.features), alternatives: safeParse(d.alternatives), keywords: safeParse(d.keywords) };
}
function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }
