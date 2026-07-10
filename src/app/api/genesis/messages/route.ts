import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import { getMessageBus } from "@/lib/genesis/agent-runtime/collab";
export async function GET() { const messages = await getMessageBus().list(50); return NextResponse.json({ messages }); }
export async function POST(req: NextRequest) {
  const _a = await guardWrite(req, "MEMBER"); if (!_a.ok) return _a.res;
  const { fromAgent, toAgent, type, payload } = await req.json();
  try { const msg = await getMessageBus().send(fromAgent, toAgent, type, payload ?? {}); return NextResponse.json({ message: msg }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 403 }); }
}
