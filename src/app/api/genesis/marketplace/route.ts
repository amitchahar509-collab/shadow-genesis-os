import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { registerApp, matchProblemToApps, marketplaceStats } from "@/lib/genesis/agent-runtime/marketplace";
import { guard, audit } from "@/lib/genesis/agent-runtime/auth";

/** GET /api/genesis/marketplace — listed apps, stats, or a problem→apps match.
 *  ?match=<problem query>  → ranked apps that solve it
 *  ?stats=1                → coverage + demand gaps
 *  ?category=Fintech  ?limit=20  → listed apps
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("match");
  if (q) return NextResponse.json({ query: q, matches: await matchProblemToApps(q, Math.min(Number(searchParams.get("limit")) || 10, 50)) });
  if (searchParams.has("stats")) return NextResponse.json({ stats: await marketplaceStats() });
  const category = searchParams.get("category") ?? undefined;
  const limit = Math.min(Number(searchParams.get("limit")) || 20, 100);
  const apps = await db.marketplaceApp.findMany({ where: { status: "LISTED", ...(category ? { category } : {}) }, orderBy: { createdAt: "desc" }, take: limit });
  return NextResponse.json({ apps: apps.map((a) => ({ ...a, keywords: safeParse(a.keywords), improvementIdeas: safeParse(a.improvementIdeas) })) });
}

/** POST /api/genesis/marketplace — register an app (fingerprint + auto-match to demand).
 *  body: { name?, opportunityId?, companyKey?, subject?, problem?, targetUsers?, features?, source?, personaCount? }
 */
export async function POST(req: NextRequest) {
  const g = await guard(req.headers.get("authorization"), "MEMBER");
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  const body = await req.json().catch(() => ({}));
  const { name, opportunityId, companyKey, subject, problem, targetUsers, features, source, personaCount } = body as Record<string, unknown>;
  if (!name && !opportunityId && !subject) return NextResponse.json({ error: "name, subject, or opportunityId required" }, { status: 400 });
  try {
    const app = await registerApp({ name: name as string, opportunityId: opportunityId as string, companyKey: companyKey as string, subject: subject as string, problem: problem as string, targetUsers: targetUsers as string, features: features as string[], source: source as "BUILT" | "USER_SUBMITTED", ownerOrgId: g.principal.local ? undefined : g.principal.orgId, personaCount: personaCount as number });
    await audit(g.principal, "MARKETPLACE_REGISTER", app.appId, `${app.category} demand ${app.demandScore}`);
    return NextResponse.json({ app });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }
