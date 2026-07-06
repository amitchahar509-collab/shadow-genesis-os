import { NextRequest, NextResponse } from "next/server";
import { getSandbox, cleanupSandbox, healthCheck, updateSandboxHealth } from "@/lib/genesis/agent-runtime/sandbox/manager";
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; const sb = await getSandbox(id); if (!sb) return NextResponse.json({ error: "not found" }, { status: 404 }); return NextResponse.json({ sandbox: sb }); }
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; await cleanupSandbox(id); return NextResponse.json({ ok: true }); }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  if (body.action === "health") { const r = await healthCheck(body.url, { timeoutMs: body.timeoutMs, intervalMs: body.intervalMs }); await updateSandboxHealth(id, r.ok ? "HEALTHY" : "UNHEALTHY"); return NextResponse.json(r); }
  return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 });
}
