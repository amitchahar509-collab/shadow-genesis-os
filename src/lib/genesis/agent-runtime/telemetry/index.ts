/** Enterprise Observability (V10 Module 5).
 *
 * Exposes Genesis's ALREADY-REAL telemetry (AgentExecution, ToolCall, LlmUsage,
 * ActivityLog, AuditLog) in the industry-standard formats real tools consume:
 *   - Prometheus exposition text (scrapeable at /api/genesis/metrics)
 *   - OpenTelemetry OTLP trace JSON assembled from the real execution hierarchy
 *   - latency percentiles (p50/p95/p99) + cost/latency analytics from real rows
 *   - Sentry / OTLP exporters — KEY-GATED (SENTRY_DSN / OTEL endpoint), never faked
 *   - a ready Grafana dashboard JSON pointing at the Prometheus metrics
 *
 * Reuses observability/metrics + router.usageSummary. Nothing is fabricated: with
 * no activity the metrics are honest zeros.
 */

import { db } from "@/lib/db";
import { getMetricsSummary } from "../observability/metrics";

const pct = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
};

// ======================= LATENCY ANALYTICS =======================

export interface LatencyStats { count: number; p50: number; p95: number; p99: number; max: number; avg: number }
function stats(durations: number[]): LatencyStats {
  const s = durations.filter((d) => d >= 0).sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return { count: s.length, p50: pct(s, 50), p95: pct(s, 95), p99: pct(s, 99), max: s[s.length - 1] ?? 0, avg: s.length ? Math.round(sum / s.length) : 0 };
}

export async function latencyAnalytics(windowHours = 24): Promise<{ executions: LatencyStats; tools: LatencyStats; llm: LatencyStats }> {
  const since = new Date(Date.now() - windowHours * 3_600_000);
  const [execs, tools, llm] = await Promise.all([
    db.agentExecution.findMany({ where: { startedAt: { gte: since }, durationMs: { gt: 0 } }, select: { durationMs: true } }),
    db.toolCall.findMany({ where: { createdAt: { gte: since } }, select: { durationMs: true } }),
    db.llmUsage.findMany({ where: { createdAt: { gte: since } }, select: { durationMs: true } }),
  ]);
  return { executions: stats(execs.map((e) => e.durationMs ?? 0)), tools: stats(tools.map((t) => t.durationMs)), llm: stats(llm.map((l) => l.durationMs)) };
}

// ======================= COST ANALYTICS =======================

export async function costAnalytics(windowHours = 24 * 7) {
  const since = new Date(Date.now() - windowHours * 3_600_000);
  const rows = await db.llmUsage.findMany({ where: { createdAt: { gte: since } } });
  const byProvider = new Map<string, { calls: number; tokens: number; costUsd: number }>();
  const byModel = new Map<string, { calls: number; costUsd: number }>();
  let totalCost = 0, totalTokens = 0;
  for (const r of rows) {
    totalCost += r.costUsd; totalTokens += r.totalTokens;
    const p = byProvider.get(r.provider) ?? { calls: 0, tokens: 0, costUsd: 0 }; p.calls++; p.tokens += r.totalTokens; p.costUsd = Math.round((p.costUsd + r.costUsd) * 1e6) / 1e6; byProvider.set(r.provider, p);
    const m = byModel.get(r.model) ?? { calls: 0, costUsd: 0 }; m.calls++; m.costUsd = Math.round((m.costUsd + r.costUsd) * 1e6) / 1e6; byModel.set(r.model, m);
  }
  return {
    windowHours, calls: rows.length, totalTokens, totalCostUsd: Math.round(totalCost * 1e6) / 1e6,
    byProvider: [...byProvider.entries()].map(([provider, v]) => ({ provider, ...v })).sort((a, b) => b.costUsd - a.costUsd),
    byModel: [...byModel.entries()].map(([model, v]) => ({ model, ...v })).sort((a, b) => b.costUsd - a.costUsd),
    costNote: "ESTIMATE — real tokens × published per-1M rates (free models = $0)",
  };
}

// ======================= DISTRIBUTED TRACING (OTLP) =======================

export interface Span { spanId: string; parentSpanId?: string; name: string; kind: string; startUnixNano: string; endUnixNano: string; durationMs: number; attributes: Record<string, string | number | boolean>; status: "OK" | "ERROR" }

/** Assemble a distributed trace for a real executionId: root span = the execution,
 *  child spans = its real tool calls + LLM calls, with real timings. */
export async function buildTrace(executionId: string): Promise<{ traceId: string; spans: Span[] } | { error: string }> {
  const exec = await db.agentExecution.findUnique({ where: { executionId } });
  if (!exec) return { error: "execution not found" };
  const [tools, llm] = await Promise.all([
    db.toolCall.findMany({ where: { executionId }, orderBy: { createdAt: "asc" } }),
    db.llmUsage.findMany({ where: { executionId }, orderBy: { createdAt: "asc" } }),
  ]);
  const traceId = executionId.replace(/[^a-zA-Z0-9]/g, "").padEnd(32, "0").slice(0, 32);
  const nano = (d: Date) => `${d.getTime()}000000`;
  const start = exec.startedAt ?? exec.createdAt;
  const rootDur = exec.durationMs ?? 0;
  const spans: Span[] = [{
    spanId: "root", name: `${exec.agent}.execute`, kind: "SERVER",
    startUnixNano: nano(start), endUnixNano: nano(new Date(start.getTime() + rootDur)), durationMs: rootDur,
    attributes: { "genesis.agent": exec.agent, "genesis.execution_id": executionId, "genesis.status": exec.status, "genesis.tool_calls": exec.toolCalls ?? 0, "genesis.tokens": exec.tokensUsed ?? 0 },
    status: exec.status === "SUCCESS" ? "OK" : "ERROR",
  }];
  for (const t of tools) {
    const ts = t.createdAt;
    spans.push({ spanId: `tool-${t.id.slice(0, 8)}`, parentSpanId: "root", name: `tool.${t.tool}.${t.operation}`, kind: "INTERNAL", startUnixNano: nano(ts), endUnixNano: nano(new Date(ts.getTime() + t.durationMs)), durationMs: t.durationMs, attributes: { "tool.name": t.tool, "tool.operation": t.operation, "tool.status": t.status }, status: t.status === "SUCCESS" ? "OK" : "ERROR" });
  }
  for (const l of llm) {
    const ls = l.createdAt;
    spans.push({ spanId: `llm-${l.id.slice(0, 8)}`, parentSpanId: "root", name: `llm.${l.provider}.${l.model}`, kind: "CLIENT", startUnixNano: nano(ls), endUnixNano: nano(new Date(ls.getTime() + l.durationMs)), durationMs: l.durationMs, attributes: { "llm.provider": l.provider, "llm.model": l.model, "llm.tokens": l.totalTokens, "llm.cost_usd": l.costUsd, "llm.fallback_depth": l.fallbackDepth }, status: l.ok ? "OK" : "ERROR" });
  }
  return { traceId, spans };
}

/** OTLP resourceSpans JSON (what an OpenTelemetry collector ingests). */
export async function otlpTrace(executionId: string): Promise<unknown | { error: string }> {
  const t = await buildTrace(executionId);
  if ("error" in t) return t;
  return {
    resourceSpans: [{
      resource: { attributes: [{ key: "service.name", value: { stringValue: "shadow-genesis-os" } }] },
      scopeSpans: [{
        scope: { name: "genesis.agent-runtime" },
        spans: t.spans.map((s) => ({
          traceId: t.traceId, spanId: s.spanId, parentSpanId: s.parentSpanId ?? "",
          name: s.name, kind: s.kind, startTimeUnixNano: s.startUnixNano, endTimeUnixNano: s.endUnixNano,
          attributes: Object.entries(s.attributes).map(([key, v]) => ({ key, value: typeof v === "number" ? { intValue: Math.round(v) } : typeof v === "boolean" ? { boolValue: v } : { stringValue: String(v) } })),
          status: { code: s.status === "OK" ? 1 : 2 },
        })),
      }],
    }],
  };
}

// ======================= PROMETHEUS EXPOSITION =======================

/** Real Prometheus exposition text — scrapeable by a real Prometheus server. */
export async function prometheusMetrics(): Promise<string> {
  const since = new Date(Date.now() - 24 * 3_600_000);
  const [execs, tools, llm, cost, lat] = await Promise.all([
    db.agentExecution.groupBy({ by: ["status"], _count: true, where: { startedAt: { gte: since } } }),
    db.toolCall.groupBy({ by: ["status"], _count: true, where: { createdAt: { gte: since } } }),
    db.llmUsage.aggregate({ _count: true, _sum: { totalTokens: true, costUsd: true }, where: { createdAt: { gte: since } } }),
    costAnalytics(24),
    latencyAnalytics(24),
  ]);
  const L: string[] = [];
  const line = (name: string, help: string, type: string, samples: { labels?: string; value: number }[]) => {
    L.push(`# HELP ${name} ${help}`); L.push(`# TYPE ${name} ${type}`);
    for (const s of samples) L.push(`${name}${s.labels ? `{${s.labels}}` : ""} ${s.value}`);
  };
  line("genesis_agent_executions_total", "Agent executions in the last 24h by status", "counter", execs.map((e) => ({ labels: `status="${e.status}"`, value: e._count })));
  line("genesis_tool_calls_total", "Tool calls in the last 24h by status", "counter", tools.map((t) => ({ labels: `status="${t.status}"`, value: t._count })));
  line("genesis_llm_calls_total", "LLM calls in the last 24h", "counter", [{ value: llm._count }]);
  line("genesis_llm_tokens_total", "LLM tokens in the last 24h", "counter", [{ value: llm._sum.totalTokens ?? 0 }]);
  line("genesis_llm_cost_usd_total", "Estimated LLM cost (USD) in the last 24h", "counter", [{ value: cost.totalCostUsd }]);
  line("genesis_execution_latency_ms", "Execution latency percentiles (ms), 24h", "gauge", [
    { labels: 'quantile="0.5"', value: lat.executions.p50 }, { labels: 'quantile="0.95"', value: lat.executions.p95 }, { labels: 'quantile="0.99"', value: lat.executions.p99 },
  ]);
  line("genesis_llm_latency_ms", "LLM call latency percentiles (ms), 24h", "gauge", [
    { labels: 'quantile="0.5"', value: lat.llm.p50 }, { labels: 'quantile="0.95"', value: lat.llm.p95 }, { labels: 'quantile="0.99"', value: lat.llm.p99 },
  ]);
  line("genesis_llm_cost_usd_by_provider", "Estimated LLM cost (USD) by provider, 24h", "gauge", cost.byProvider.map((p) => ({ labels: `provider="${p.provider}"`, value: p.costUsd })));
  return L.join("\n") + "\n";
}

// ======================= EXPORTER HEALTH =======================

export function observabilityBackends(): { name: string; kind: string; available: boolean; note: string }[] {
  return [
    { name: "prometheus", kind: "METRICS", available: true, note: "scrape GET /api/genesis/metrics (exposition text — always on)" },
    { name: "grafana", kind: "DASHBOARD", available: true, note: "import the dashboard JSON from GET /api/genesis/telemetry?grafana=1 (reads Prometheus)" },
    { name: "opentelemetry", kind: "TRACING", available: !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT, note: "set OTEL_EXPORTER_OTLP_ENDPOINT to export OTLP traces" },
    { name: "sentry", kind: "ERRORS", available: !!process.env.SENTRY_DSN, note: "set SENTRY_DSN to forward real error events" },
  ];
}

// ======================= GRAFANA DASHBOARD =======================

export function grafanaDashboard(): unknown {
  const panel = (id: number, title: string, expr: string, x: number, y: number) => ({ id, title, type: "timeseries", datasource: { type: "prometheus", uid: "${DS_PROMETHEUS}" }, gridPos: { h: 8, w: 12, x, y }, targets: [{ expr, refId: "A" }] });
  return {
    __inputs: [{ name: "DS_PROMETHEUS", label: "Prometheus", type: "datasource", pluginId: "prometheus" }],
    title: "Shadow Genesis OS — Observability", uid: "genesis-observability", schemaVersion: 39, version: 1,
    panels: [
      panel(1, "Agent executions (24h)", "sum by (status) (genesis_agent_executions_total)", 0, 0),
      panel(2, "LLM cost USD (24h)", "genesis_llm_cost_usd_total", 12, 0),
      panel(3, "Execution latency p95 (ms)", 'genesis_execution_latency_ms{quantile="0.95"}', 0, 8),
      panel(4, "LLM latency p95 (ms)", 'genesis_llm_latency_ms{quantile="0.95"}', 12, 8),
    ],
  };
}

// ======================= OVERVIEW =======================

export async function telemetryOverview() {
  const [summary, cost, latency] = await Promise.all([getMetricsSummary(24), costAnalytics(24), latencyAnalytics(24)]);
  const auditCount = await db.auditLog.count();
  return { summary, cost, latency, backends: observabilityBackends(), auditLogEntries: auditCount, note: "all telemetry computed from REAL execution/tool/llm/audit rows — zeros are honest, never fabricated" };
}
