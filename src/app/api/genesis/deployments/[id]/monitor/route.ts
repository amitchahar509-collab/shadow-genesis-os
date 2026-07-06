import { NextRequest, NextResponse } from "next/server";
import { startMonitoring, stopMonitoring, getMonitorStatus } from "@/lib/genesis/agent-runtime/deployment/health-monitor";
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const status = getMonitorStatus(id);
  if (!status) return NextResponse.json({ running: false });
  return NextResponse.json(status);
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  if (body.action === "start") {
    if (!body.url) return NextResponse.json({ error: "url required" }, { status: 400 });
    const handle = startMonitoring(id, body.url, { intervalMs: body.intervalMs, failureThreshold: body.failureThreshold, maxDurationMs: body.maxDurationMs, rollbackAfterMs: body.rollbackAfterMs });
    return NextResponse.json({ monitor: { recordId: handle.recordId, url: handle.url, startedAt: handle.startedAt } });
  }
  if (body.action === "stop") { stopMonitoring(id); return NextResponse.json({ ok: true }); }
  return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 });
}
