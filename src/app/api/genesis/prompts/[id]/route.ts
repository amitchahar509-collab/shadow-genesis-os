import { NextRequest, NextResponse } from "next/server";
import { activateVersion, recordOutcome } from "@/lib/genesis/agent-runtime/improvement/prompts";
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  if (body.action === "activate") { const p = await activateVersion(id); if (!p) return NextResponse.json({ error: "not found" }, { status: 404 }); return NextResponse.json({ prompt: p }); }
  if (body.action === "record-outcome") { await recordOutcome(id, Boolean(body.success)); return NextResponse.json({ ok: true }); }
  return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 });
}
