import { NextRequest, NextResponse } from "next/server";
import { getCostSummary } from "@/lib/genesis/agent-runtime/observability/metrics";
export async function GET(req: NextRequest) {
  const days = Number(new URL(req.url).searchParams.get("days") ?? 7);
  const cost = await getCostSummary(days);
  return NextResponse.json(cost);
}
