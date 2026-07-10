/** Shared route guard for mutation endpoints — auth + per-org usage limit + audit.
 *
 * Usage in a route handler:
 *   const a = await guardWrite(req, "MEMBER");
 *   if (!a.ok) return a.res;
 *   // ... a.principal is available
 *
 * Behaviour mirrors the auth module's local-first design: when
 * GENESIS_AUTH_REQUIRED is unset an absent key runs as the LOCAL principal
 * (dashboard keeps working, unmetered); when enforced, a valid key with the
 * required role is needed (401/403), and real org keys are metered (429).
 */

import { NextResponse } from "next/server";
import { guard, checkAndRecordUsage, audit, type Role, type Principal } from "@/lib/genesis/agent-runtime/auth";

export async function guardWrite(req: Request, minRole: Role = "MEMBER"): Promise<{ ok: true; principal: Principal } | { ok: false; res: NextResponse }> {
  const g = await guard(req.headers.get("authorization"), minRole);
  if (!g.ok) return { ok: false, res: NextResponse.json({ error: g.error }, { status: g.status }) };

  const u = await checkAndRecordUsage(g.principal);
  if (!u.ok) return { ok: false, res: NextResponse.json({ error: u.error, limit: u.limit }, { status: 429 }) };

  let pathname = req.url;
  try { pathname = new URL(req.url).pathname; } catch { /* keep raw */ }
  await audit(g.principal, "API_WRITE", `${req.method} ${pathname}`);
  return { ok: true, principal: g.principal };
}
