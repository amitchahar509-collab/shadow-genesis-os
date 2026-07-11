import { prometheusMetrics } from "@/lib/genesis/agent-runtime/telemetry";

/** GET /api/genesis/metrics/prometheus — real Prometheus exposition text.
 *  Point a Prometheus scrape config at this URL. Content-Type per the spec.
 */
export async function GET() {
  const body = await prometheusMetrics();
  return new Response(body, { headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" } });
}
