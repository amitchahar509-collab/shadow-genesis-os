/** V10 Module 5 — Enterprise Observability. Real telemetry in standard formats:
 *  Prometheus exposition, OTLP traces from the real execution hierarchy, latency
 *  percentiles, key-gated Sentry/OTLP exporters. Network-free; honest zeros. */

import { test, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { db } from "@/lib/db";
import { prometheusMetrics, buildTrace, otlpTrace, latencyAnalytics, costAnalytics, observabilityBackends, grafanaDashboard } from "@/lib/genesis/agent-runtime/telemetry";
import { exportErrorToSentry, exportTraceToOtlp } from "@/lib/genesis/agent-runtime/telemetry/exporters";
import type { FetchLike } from "@/lib/genesis/agent-runtime/world-scanner/connectors";

const EXID = "EX-TELTEST01";
const ENVK = ["SENTRY_DSN", "OTEL_EXPORTER_OTLP_ENDPOINT"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENVK) saved[k] = process.env[k];

async function wipe() {
  await db.toolCall.deleteMany({ where: { executionId: EXID } });
  await db.llmUsage.deleteMany({ where: { executionId: EXID } });
  await db.agentExecution.deleteMany({ where: { executionId: EXID } });
}
async function seedExecution() {
  const now = new Date();
  await db.agentExecution.create({ data: { executionId: EXID, agent: "TELTEST", goal: "trace me", status: "SUCCESS", startedAt: now, completedAt: new Date(now.getTime() + 500), durationMs: 500, toolCalls: 2, tokensUsed: 300 } });
  await db.toolCall.create({ data: { executionId: EXID, tool: "filesystem", operation: "write", input: "{}", output: "{}", status: "SUCCESS", durationMs: 40 } });
  await db.toolCall.create({ data: { executionId: EXID, tool: "terminal", operation: "exec", input: "{}", output: "{}", status: "ERROR", durationMs: 120 } });
  await db.llmUsage.create({ data: { agent: "TELTEST", capability: "REASONING", provider: "gemini", model: "gemini-flash-lite-latest", promptTokens: 100, completionTokens: 200, totalTokens: 300, costUsd: 0, durationMs: 800, ok: true, executionId: EXID } });
}

beforeEach(async () => { for (const k of ENVK) delete process.env[k]; await wipe(); });
afterEach(() => { for (const k of ENVK) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
afterAll(wipe);

test("Prometheus exposition is valid format with real metric families", async () => {
  await seedExecution();
  const text = await prometheusMetrics();
  expect(text).toContain("# HELP genesis_agent_executions_total");
  expect(text).toContain("# TYPE genesis_agent_executions_total counter");
  expect(text).toMatch(/genesis_agent_executions_total\{status="SUCCESS"\} \d+/);
  expect(text).toContain("genesis_llm_tokens_total");
  expect(text).toMatch(/genesis_execution_latency_ms\{quantile="0.95"\}/);
  // every non-comment line is `name{labels} value` or `name value`
  for (const l of text.split("\n").filter((x) => x && !x.startsWith("#"))) expect(l).toMatch(/^[a-z_]+(\{.*\})? -?\d+(\.\d+)?$/);
});

test("distributed trace assembles the REAL execution→tool→llm hierarchy", async () => {
  await seedExecution();
  const t = await buildTrace(EXID);
  expect("spans" in t).toBe(true);
  if (!("spans" in t)) return;
  const root = t.spans.find((s) => s.spanId === "root")!;
  expect(root.name).toBe("TELTEST.execute");
  expect(root.durationMs).toBe(500);
  const children = t.spans.filter((s) => s.parentSpanId === "root");
  expect(children.length).toBe(3); // 2 tools + 1 llm
  const errSpan = t.spans.find((s) => s.name.includes("terminal"))!;
  expect(errSpan.status).toBe("ERROR"); // the failed tool call is a real ERROR span
  const llmSpan = t.spans.find((s) => s.name.includes("gemini"))!;
  expect(llmSpan.attributes["llm.tokens"]).toBe(300);
});

test("OTLP payload is well-formed resourceSpans a collector can ingest", async () => {
  await seedExecution();
  const p = await otlpTrace(EXID) as { resourceSpans: { scopeSpans: { spans: { traceId: string; status: { code: number } }[] }[] }[] };
  const spans = p.resourceSpans[0].scopeSpans[0].spans;
  expect(spans.length).toBe(4); // root + 2 tools + 1 llm
  expect(spans[0].traceId).toHaveLength(32); // valid OTLP trace id
  expect(spans.some((s) => s.status.code === 2)).toBe(true); // the ERROR tool span
});

test("latency analytics compute real percentiles from real durations", async () => {
  await seedExecution();
  const lat = await latencyAnalytics(24);
  expect(lat.tools.count).toBeGreaterThanOrEqual(2);
  expect(lat.tools.p95).toBeGreaterThanOrEqual(lat.tools.p50);
  expect(lat.llm.max).toBeGreaterThanOrEqual(800);
});

test("cost analytics aggregate real usage (free model = $0, honest)", async () => {
  await seedExecution();
  const c = await costAnalytics(24);
  expect(c.calls).toBeGreaterThanOrEqual(1);
  expect(c.totalTokens).toBeGreaterThanOrEqual(300);
  expect(c.byProvider.some((p) => p.provider === "gemini")).toBe(true);
  expect(c.costNote).toContain("ESTIMATE");
});

test("backends: Prometheus+Grafana always on; OTel/Sentry key-gated", () => {
  const b = observabilityBackends();
  expect(b.find((x) => x.name === "prometheus")!.available).toBe(true);
  expect(b.find((x) => x.name === "opentelemetry")!.available).toBe(false); // no endpoint set
  expect(b.find((x) => x.name === "sentry")!.available).toBe(false);
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318";
  expect(observabilityBackends().find((x) => x.name === "opentelemetry")!.available).toBe(true);
});

test("Grafana dashboard JSON references the real Prometheus metrics", () => {
  const d = grafanaDashboard() as { panels: { targets: { expr: string }[] }[] };
  const exprs = d.panels.flatMap((p) => p.targets.map((t) => t.expr)).join(" ");
  expect(exprs).toContain("genesis_agent_executions_total");
  expect(exprs).toContain("genesis_llm_cost_usd_total");
});

test("exporters are KEY-GATED — honest no-op without config, never a fake success", async () => {
  const s = await exportErrorToSentry({ message: "boom" });
  expect(s.exported).toBe(false);
  expect(s.reason).toContain("SENTRY_DSN not set");
  const o = await exportTraceToOtlp(EXID);
  expect(o.exported).toBe(false);
  expect(o.reason).toContain("OTEL_EXPORTER_OTLP_ENDPOINT not set");
});

test("configured Sentry forwards a real event via the seam", async () => {
  process.env.SENTRY_DSN = "https://abc123@o1.ingest.sentry.io/456";
  let hitUrl = "";
  const seam: FetchLike = async (url) => { hitUrl = url; return { ok: true, status: 200, json: async () => ({}), text: async () => "ok" }; };
  const r = await exportErrorToSentry({ message: "real error", agent: "TELTEST" }, { fetchImpl: seam });
  expect(r.exported).toBe(true);
  expect(hitUrl).toBe("https://o1.ingest.sentry.io/api/456/store/"); // real Sentry store URL from the DSN
});

test("configured OTLP exports the real trace via the seam", async () => {
  await seedExecution();
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://collector:4318";
  let hitUrl = "";
  const seam: FetchLike = async (url) => { hitUrl = url; return { ok: true, status: 200, json: async () => ({}), text: async () => "ok" }; };
  const r = await exportTraceToOtlp(EXID, { fetchImpl: seam });
  expect(r.exported).toBe(true);
  expect(r.spans).toBe(4);
  expect(hitUrl).toBe("http://collector:4318/v1/traces");
});
