"use client";

/** V10 Module 12 — Performance Center: cache analytics, queue monitor, model
 *  optimization, measured benchmarks. Every gain is measured — no fabricated speedups.
 */

import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { Chip, HudPanel } from "../primitives";

interface Overview {
  cache: { hitRatio: number; l1Hits: number; l2Hits: number; misses: number; persistedEntries: number; prunedExpired: number };
  queue: { byStatus: Record<string, number>; total: number; avgLatencyMs: number };
  modelOptimization: { baseline: { model: string; combinedPricePer1M: number } | null; optimized: { model: string; combinedPricePer1M: number } | null; costSavedPer1M: number; savedPct: number } | null;
  ledger7d: { calls: number; tokens: number; costUsd: number; retries: number; fallbackUsed: number };
}
interface Bench { benchmarks: { name: string; beforeMs: number; afterMs: number; improvementPct: number; detail: string }[] }

const QUEUE_STATES = ["READY", "RUNNING", "WAITING", "RETRY", "FAILED", "DEAD_LETTER", "COMPLETED"];

export function Performance() {
  const [d, setD] = useState<Overview | null>(null);
  const [bench, setBench] = useState<Bench | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => { try { const r = await fetch("/api/genesis/performance").then((x) => x.json()); if (alive) setD(r); } catch { /* empty */ } };
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const runBench = async () => { setBusy(true); try { setBench(await fetch("/api/genesis/performance?benchmark=1").then((x) => x.json())); } finally { setBusy(false); } };

  return (
    <HudPanel
      title="Performance Center"
      subtitle="cache · queue · parallel scheduler · model optimization — every gain MEASURED, never fabricated"
      icon={<Gauge className="w-3.5 h-3.5" />}
      accent="cyan"
      right={<button onClick={runBench} disabled={busy} className="font-mono text-[10px] uppercase tracking-wider px-2.5 py-1 rounded border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-50">{busy ? "measuring…" : "run benchmark"}</button>}
    >
      {!d ? <Empty text="loading…" /> : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-[10px]">
            <Stat name="cache hit ratio" v={`${Math.round(d.cache.hitRatio * 100)}%`} />
            <Stat name="cache entries" v={String(d.cache.persistedEntries)} />
            <Stat name="queue tasks" v={String(d.queue.total)} />
            <Stat name="avg task latency" v={`${d.queue.avgLatencyMs}ms`} />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {QUEUE_STATES.map((s) => (
              <span key={s} className="font-mono text-[9px] px-1.5 py-0.5 rounded border border-cyan-500/15 text-zinc-400">{s} <span className="text-cyan-300">{d.queue.byStatus[s] ?? 0}</span></span>
            ))}
          </div>

          {d.modelOptimization?.optimized && (
            <div className="font-mono text-[9px] text-zinc-500">
              model opt (CHEAP): {d.modelOptimization.baseline?.model} → {d.modelOptimization.optimized.model}
              {d.modelOptimization.costSavedPer1M > 0 ? <span className="text-emerald-300"> saves ${d.modelOptimization.costSavedPer1M}/1M ({d.modelOptimization.savedPct}%)</span> : <span className="text-zinc-500"> already cheapest at tier</span>}
            </div>
          )}
          <div className="font-mono text-[9px] text-zinc-500">7d ledger: {d.ledger7d.calls} calls · {d.ledger7d.tokens.toLocaleString()} tokens · ${d.ledger7d.costUsd} · {d.ledger7d.retries} retries · {d.ledger7d.fallbackUsed} fallback</div>

          {bench && (
            <div className="overflow-x-auto border-t border-cyan-500/10 pt-2">
              <table className="w-full font-mono text-[10px]">
                <thead><tr className="text-zinc-500 uppercase tracking-wider text-left"><th className="py-1 pr-3">benchmark</th><th className="pr-3">before</th><th className="pr-3">after</th><th className="pr-3">Δ</th><th>detail</th></tr></thead>
                <tbody>
                  {bench.benchmarks.map((b) => (
                    <tr key={b.name} className="border-t border-cyan-500/10 text-zinc-300">
                      <td className="py-1 pr-3 text-cyan-300">{b.name}</td>
                      <td className="pr-3">{b.beforeMs}</td>
                      <td className="pr-3">{b.afterMs}</td>
                      <td className="pr-3"><Chip variant={b.improvementPct > 0 ? "emerald" : "zinc"}>{b.improvementPct}%</Chip></td>
                      <td className="text-zinc-500 max-w-[240px] truncate">{b.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider">only deterministic outputs cached (never approval/security/external) · benchmarks measure real wall time</div>
        </div>
      )}
    </HudPanel>
  );
}

function Stat({ name, v }: { name: string; v: string }) {
  return (
    <div className="border border-cyan-500/15 rounded px-2.5 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{name}</div>
      <div className="text-cyan-300 text-sm">{v}</div>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="font-mono text-[10px] text-zinc-600 py-4 text-center uppercase tracking-wider">{text}</div>;
}
