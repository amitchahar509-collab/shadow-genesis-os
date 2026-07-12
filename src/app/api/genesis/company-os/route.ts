import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import { companyOverview, companyWorkspace, companyHealth, ensureCompany } from "@/lib/genesis/agent-runtime/company-os";

/** GET /api/genesis/company-os — portfolio roll-up.
 *  ?workspace=<key> → full 10-section view  ·  ?health=<key> → composite health
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ws = searchParams.get("workspace");
  if (ws) { const r = await companyWorkspace(ws); return NextResponse.json(r, { status: "error" in r ? 404 : 200 }); }
  const health = searchParams.get("health");
  if (health) return NextResponse.json(await companyHealth(health));
  return NextResponse.json(await companyOverview());
}

/** POST /api/genesis/company-os — { action: "ensure", key, name?, mission? }. */
export async function POST(req: NextRequest) {
  const g = await guardWrite(req, "MEMBER");
  if (!g.ok) return g.res;
  const b = await req.json().catch(() => ({}));
  if (b.action === "ensure") {
    if (!b.key) return NextResponse.json({ error: "key required" }, { status: 400 });
    return NextResponse.json(await ensureCompany(String(b.key), { name: b.name, mission: b.mission }));
  }
  return NextResponse.json({ error: "action must be ensure" }, { status: 400 });
}
