import { NextRequest, NextResponse } from "next/server";
import { getMetricsSummary } from "@/lib/genesis/agent-runtime/observability/metrics";
export async function GET(req: NextRequest) {
  const windowHours = Number(new URL(req.url).searchParams.get("windowHours") ?? 24);
  const summary = await getMetricsSummary(windowHours);
  return NextResponse.json(summary);
}
