import { NextRequest, NextResponse } from "next/server";
import { getProviderStatus, checkProvider } from "@/lib/genesis/agent-runtime/provider";
import { guard } from "@/lib/genesis/agent-runtime/auth";

/** GET /api/genesis/provider — LLM provider status + capability matrix (open read for the dashboard badge). */
export async function GET() {
  return NextResponse.json({ status: getProviderStatus() });
}

/** POST /api/genesis/provider — real self-test round-trip through the adapter (makes an external call when keyed). */
export async function POST(req: NextRequest) {
  const g = await guard(req.headers.get("authorization"), "MEMBER");
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  return NextResponse.json({ check: await checkProvider() });
}
