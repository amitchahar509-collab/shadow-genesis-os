"use client";

/** V10 Module 5 — Observability panel: real latency/cost analytics + backend
 *  readiness. All figures come from real execution/tool/llm rows — zeros are honest.
 */

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { HudPanel } from "../primitives";

interface Lat { count: number; p50: number; p95: number; p99: number; avg: number }
interface Overview {
  cost: { calls: number; totalTokens: number; totalCostUsd: number; byProvider: { provider: string; costUsd: number }[] };
  latency: { executions: Lat; tools: Lat; llm: Lat };
  backends: { name: string; kind: string; available: boolean; note: string }[];
  auditLogEntries: number;
}

function LatRow({ name, l }: { name: string; l: Lat }) {
  return (
    <tr className="border-t border-cyan-500/10 text-zinc-300">
      <td className="py-1 pr-3 text-zinc-400">{name}</td>
      <td className="pr-3">{l.count}</td>
      <td className="pr-3">{l.p50}ms</td>
      <td className="pr-3">{l.p95}ms</td>
      <td className="pr-3">{l.p99}ms</td>
      <td>{l.avg}ms</td>
    </tr>
  );
}

export function Observability() {
  const [d, setD] = useState<Overview | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => { try { const r = await fetch("/api/genesis/telemetry").then((x) => x.json()); if (alive) setD(r); } catch { /* empty */ } };
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <HudPanel
      title="Enterprise Observability"
      subtitle="Prometheus · OpenTelemetry · Grafana · Sentry — real latency/cost from real rows"
      icon={<Activity className="w-3.5 h-3.5" />}
      accent="cyan"
    >
      {!d ? <Empty text="loading…" /> : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {d.backends.map((b) => (
              <span key={b.name} title={b.note} className={`font-mono text-[9px] px-1.5 py-0.5 rounded border ${b.available ? "border-cyan-500/30 text-cyan-300" : "border-zinc-700 text-zinc-600"}`}>{b.name}:{b.available ? "on" : "off"}</span>
            ))}
            <span className="font-mono text-[9px] px-1.5 py-0.5 rounded border border-zinc-600/30 text-zinc-500">audit log {d.auditLogEntries}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full font-mono text-[10px]">
              <thead><tr className="text-zinc-500 uppercase tracking-wider text-left">
                <th className="py-1 pr-3">latency (24h)</th><th className="pr-3">n</th><th className="pr-3">p50</th><th className="pr-3">p95</th><th className="pr-3">p99</th><th>avg</th>
              </tr></thead>
              <tbody>
                <LatRow name="executions" l={d.latency.executions} />
                <LatRow name="tool calls" l={d.latency.tools} />
                <LatRow name="llm calls" l={d.latency.llm} />
              </tbody>
            </table>
          </div>

          <div className="font-mono text-[9px] text-zinc-500">
            cost 24h: {d.cost.calls} calls · {d.cost.totalTokens.toLocaleString()} tokens · ${d.cost.totalCostUsd} ({d.cost.byProvider.map((p) => `${p.provider} $${p.costUsd}`).join(" · ") || "—"})
          </div>
          <div className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider">scrape: GET /api/genesis/metrics/prometheus · traces: ?trace=&lt;executionId&gt; · all from REAL rows — zeros are honest</div>
        </div>
      )}
    </HudPanel>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="font-mono text-[10px] text-zinc-600 py-4 text-center uppercase tracking-wider">{text}</div>;
}
