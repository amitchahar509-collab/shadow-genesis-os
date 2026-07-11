import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import { telemetryOverview, buildTrace, otlpTrace, grafanaDashboard, latencyAnalytics, costAnalytics } from "@/lib/genesis/agent-runtime/telemetry";
import { exportErrorToSentry, exportTraceToOtlp } from "@/lib/genesis/agent-runtime/telemetry/exporters";

/** GET /api/genesis/telemetry — observability overview.
 *  ?trace=<executionId>  ?otlp=<executionId>  ?grafana=1  ?latency=1  ?cost=1
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const trace = searchParams.get("trace");
  const otlp = searchParams.get("otlp");
  if (trace) return NextResponse.json(await buildTrace(trace));
  if (otlp) return NextResponse.json(await otlpTrace(otlp));
  if (searchParams.get("grafana") === "1") return NextResponse.json(grafanaDashboard());
  if (searchParams.get("latency") === "1") return NextResponse.json(await latencyAnalytics(Number(searchParams.get("hours")) || 24));
  if (searchParams.get("cost") === "1") return NextResponse.json(await costAnalytics(Number(searchParams.get("hours")) || 24 * 7));
  return NextResponse.json(await telemetryOverview());
}

/** POST /api/genesis/telemetry — { action: "export-trace"|"export-error", ... }.
 *  Exporters are key-gated; with no SENTRY_DSN / OTEL endpoint they honestly no-op.
 */
export async function POST(req: NextRequest) {
  const g = await guardWrite(req, "MEMBER");
  if (!g.ok) return g.res;
  const b = await req.json().catch(() => ({}));
  const { action } = b as { action?: string };
  switch (action) {
    case "export-trace": {
      if (!b.executionId) return NextResponse.json({ error: "executionId required" }, { status: 400 });
      return NextResponse.json(await exportTraceToOtlp(String(b.executionId)));
    }
    case "export-error": {
      if (!b.message) return NextResponse.json({ error: "message required" }, { status: 400 });
      return NextResponse.json(await exportErrorToSentry({ message: String(b.message), level: b.level, executionId: b.executionId, agent: b.agent }));
    }
    default:
      return NextResponse.json({ error: "action must be export-trace|export-error" }, { status: 400 });
  }
}
