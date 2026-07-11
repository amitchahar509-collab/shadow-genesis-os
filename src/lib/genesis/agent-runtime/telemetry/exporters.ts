/** Key-gated telemetry exporters (V10 Module 5) — REAL outbound integrations.
 *
 * Sentry (SENTRY_DSN) and OpenTelemetry (OTEL_EXPORTER_OTLP_ENDPOINT) only fire
 * when their env is configured; with no config they are honest no-ops (exported:
 * false) — never a fake success. Reuses the World Scanner FetchLike seam.
 */

import { otlpTrace } from "./index";
import type { FetchLike } from "../world-scanner/connectors";

const realFetch: FetchLike = async (url, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const xbody = init?.headers?.["x-body"];
    const r = await fetch(url, { method: "POST", headers: init?.headers, body: xbody, signal: controller.signal });
    return { ok: r.ok, status: r.status, json: () => r.json(), text: () => r.text() };
  } finally { clearTimeout(timer); }
};

/** Forward a REAL error event to Sentry (Store API) when SENTRY_DSN is set. */
export async function exportErrorToSentry(input: { message: string; level?: string; executionId?: string; agent?: string; tags?: Record<string, string> }, opts?: { fetchImpl?: FetchLike }): Promise<{ exported: boolean; reason?: string }> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return { exported: false, reason: "SENTRY_DSN not set — error not forwarded (honest no-op)" };
  // parse a real Sentry DSN: https://<key>@<host>/<projectId>
  const m = dsn.match(/^https:\/\/([^@]+)@([^/]+)\/(\d+)$/);
  if (!m) return { exported: false, reason: "SENTRY_DSN malformed" };
  const [, key, host, projectId] = m;
  const url = `https://${host}/api/${projectId}/store/`;
  const body = JSON.stringify({ message: input.message, level: input.level ?? "error", platform: "node", tags: { agent: input.agent ?? "genesis", executionId: input.executionId ?? "", ...input.tags }, timestamp: Date.now() / 1000 });
  const fetchImpl = opts?.fetchImpl ?? realFetch;
  try {
    const r = await fetchImpl(url, { headers: { "content-type": "application/json", "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${key}`, "x-body": body } });
    return { exported: r.ok, reason: r.ok ? undefined : `sentry HTTP ${r.status}` };
  } catch (e) { return { exported: false, reason: e instanceof Error ? e.message : String(e) }; }
}

/** Export a REAL execution trace as OTLP to the configured collector endpoint. */
export async function exportTraceToOtlp(executionId: string, opts?: { fetchImpl?: FetchLike }): Promise<{ exported: boolean; reason?: string; spans?: number }> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return { exported: false, reason: "OTEL_EXPORTER_OTLP_ENDPOINT not set — trace not exported (honest no-op)" };
  const payload = await otlpTrace(executionId);
  if (payload && typeof payload === "object" && "error" in payload) return { exported: false, reason: (payload as { error: string }).error };
  const spanCount = (payload as { resourceSpans?: { scopeSpans?: { spans?: unknown[] }[] }[] }).resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.length ?? 0;
  const url = `${endpoint.replace(/\/$/, "")}/v1/traces`;
  const headers: Record<string, string> = { "content-type": "application/json", "x-body": JSON.stringify(payload) };
  if (process.env.OTEL_EXPORTER_OTLP_HEADERS) { const hm = process.env.OTEL_EXPORTER_OTLP_HEADERS.match(/^([^=]+)=(.+)$/); if (hm) headers[hm[1].trim()] = hm[2].trim(); }
  const fetchImpl = opts?.fetchImpl ?? realFetch;
  try {
    const r = await fetchImpl(url, { headers });
    return { exported: r.ok, reason: r.ok ? undefined : `otlp HTTP ${r.status}`, spans: spanCount };
  } catch (e) { return { exported: false, reason: e instanceof Error ? e.message : String(e) }; }
}
