"use client";

/** G12 — Benchmark Arena panel: Genesis's self-measurement, visible.
 *  Autonomy score + per-capability pass/score, run history, and a RUN button.
 *  Rendered inside the Venture Intelligence tab.
 */

import { useCallback, useEffect, useState } from "react";
import { Gauge, Play } from "lucide-react";
import { Chip, GenesisProgress, HudPanel } from "../primitives";

interface TaskResult { id: string; capability: string; pass: boolean; score: number; ms: number; detail: string }
interface Run { runId: string; suite: string; autonomyScore: number; successRate: number; passed: number; totalTasks: number; durationMs: number; tokensUsed: number; mode: string; results: TaskResult[]; createdAt: string }

export function BenchmarkArena() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await fetch("/api/genesis/benchmark?limit=8").then((x) => x.json());
      setRuns(d.runs ?? []);
    } catch { /* empty */ }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const run = async () => {
    setRunning(true);
    try {
      await fetch("/api/genesis/benchmark", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ suite: "intelligence", background: false }) });
      await load();
    } finally { setRunning(false); }
  };

  const latest = runs[0];

  return (
    <HudPanel
      title="Benchmark Arena"
      subtitle="autonomy self-measurement · discrimination + decision-chain, real execution"
      icon={<Gauge className="w-3.5 h-3.5" />}
      accent="emerald"
      right={
        <button
          onClick={run}
          disabled={running}
          className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider px-2.5 py-1 rounded border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
        ><Play className="w-3 h-3" /> {running ? "running…" : "run benchmark"}</button>
      }
    >
      {!latest ? <div className="font-mono text-[10px] text-zinc-600 py-4 text-center uppercase tracking-wider">no runs yet — press RUN BENCHMARK</div> : (
        <div className="space-y-3">
          {/* Latest score */}
          <div className="flex items-center gap-3">
            <div className="font-mono text-2xl text-emerald-400 tabular-nums">{latest.autonomyScore}<span className="text-zinc-600 text-sm">/100</span></div>
            <div className="flex-1">
              <GenesisProgress value={latest.autonomyScore} accent="emerald" showShimmer />
              <div className="flex items-center gap-2 mt-1 font-mono text-[9px] text-zinc-500 uppercase tracking-wider">
                <Chip variant={latest.successRate === 100 ? "emerald" : "amber"}>{latest.passed}/{latest.totalTasks} passed</Chip>
                <Chip variant={latest.mode === "HEURISTIC" ? "amber" : "cyan"}>{latest.mode}</Chip>
                <span>{latest.durationMs}ms · {latest.tokensUsed} tok</span>
              </div>
            </div>
          </div>

          {/* Per-capability */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {latest.results.map((r) => (
              <div key={r.id} className="border border-emerald-500/10 rounded-sm p-2" title={r.detail}>
                <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-500 flex items-center gap-1">
                  <span className={r.pass ? "text-emerald-400" : "text-rose-400"}>{r.pass ? "●" : "✕"}</span>{r.capability}
                </div>
                <div className={`font-mono text-sm tabular-nums ${r.pass ? "text-zinc-200" : "text-rose-300"}`}>{r.score}</div>
              </div>
            ))}
          </div>

          {/* History sparkline-ish */}
          {runs.length > 1 && (
            <div className="flex items-end gap-1 h-8 pt-1">
              {[...runs].reverse().map((r) => (
                <div key={r.runId} className="flex-1 bg-emerald-500/30 rounded-sm" style={{ height: `${Math.max(6, r.autonomyScore)}%` }} title={`${r.runId}: ${r.autonomyScore}/100 (${r.mode})`} />
              ))}
            </div>
          )}
          <div className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider">heuristic scores rise automatically once an LLM key replaces the rule-based reasoning</div>
        </div>
      )}
    </HudPanel>
  );
}
