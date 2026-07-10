import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import { computeAllAgentMetrics, computeAgentMetrics } from "@/lib/genesis/agent-runtime/observability/metrics";
export async function POST(req: NextRequest) {
  const _a = await guardWrite(req, "ADMIN"); if (!_a.ok) return _a.res;
  const body = await req.json().catch(() => ({}));
  const windowHours = Number(body.windowHours ?? 24);
  if (body.agent) { const m = await computeAgentMetrics(body.agent, windowHours); return NextResponse.json({ metric: m }); }
  const metrics = await computeAllAgentMetrics(windowHours);
  return NextResponse.json({ metrics, count: metrics.length });
}
