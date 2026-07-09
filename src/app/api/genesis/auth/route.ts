import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bootstrap, createApiKey, guard, isProvisioned, audit, type Role } from "@/lib/genesis/agent-runtime/auth";

/** GET /api/genesis/auth
 *  ?me      → whoami for the presented key
 *  ?audit   → recent audit log (ADMIN+)
 *  (default) → provisioning status + whether enforcement is on
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const auth = req.headers.get("authorization");

  if (searchParams.has("me")) {
    const g = await guard(auth, "VIEWER");
    if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
    return NextResponse.json({ principal: g.principal });
  }
  if (searchParams.has("audit")) {
    const g = await guard(auth, "ADMIN");
    if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
    const logs = await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(Number(searchParams.get("limit")) || 50, 200) });
    return NextResponse.json({ audit: logs });
  }
  return NextResponse.json({ provisioned: await isProvisioned(), enforcement: process.env.GENESIS_AUTH_REQUIRED === "1" ? "REQUIRED" : "LOCAL" });
}

/** POST /api/genesis/auth
 *  { action: "bootstrap", email, name?, orgName? }  → first-run: creates owner + org + OWNER key (once)
 *  { action: "createKey", label?, role? }           → mint a key (OWNER/ADMIN)
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action = (body as { action?: string }).action;

  if (action === "bootstrap") {
    const { email, name, orgName } = body as { email?: string; name?: string; orgName?: string };
    if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
    try {
      const r = await bootstrap({ email, name, orgName });
      return NextResponse.json({ ...r, apiKeyNote: "store this key now — it is shown only once" });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
    }
  }

  if (action === "createKey") {
    const g = await guard(req.headers.get("authorization"), "ADMIN");
    if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
    const { label, role } = body as { label?: string; role?: Role };
    const effRole: Role = role && ["ADMIN", "MEMBER", "VIEWER"].includes(role) ? role : "MEMBER"; // can't mint OWNER keys via API
    const key = await createApiKey({ userId: g.principal.userId, orgId: g.principal.orgId, role: effRole, label });
    await audit(g.principal, "KEY_CREATE", key.keyId, `role ${effRole}`);
    return NextResponse.json({ ...key, apiKeyNote: "store this key now — it is shown only once" });
  }

  return NextResponse.json({ error: "action must be 'bootstrap' or 'createKey'" }, { status: 400 });
}
