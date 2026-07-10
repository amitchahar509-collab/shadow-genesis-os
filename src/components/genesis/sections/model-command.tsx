"use client";

/** V9 — Model Command Center: the multi-brain layer, visible.
 *  Active models (registry + measured stats), live per-agent routing, usage/cost,
 *  failures, and the duel leaderboard. Rendered in the Venture Intelligence tab.
 */

import { useEffect, useState } from "react";
import { Cpu, RefreshCw } from "lucide-react";
import { Chip, GenesisProgress, HudPanel } from "../primitives";

interface RegistryRow { modelId: string; family: string; provider: string; active: boolean; reasoningTier: number; codingTier: number; researchTier: number; reliability: number; avgLatencyMs: number; measuredWins: number; measuredLosses: number; promptPrice: number; completionPrice: number }
interface Routing { agent: string; capability: string; models: string[] }
interface Usage { calls: number; okCalls: number; fallbackCalls: number; retriedCalls: number; totalTokens: number; totalCostUsd: number; byModel: Record<string, { calls: number; tokens: number; costUsd: number; failures: number }> }

const FAM_CHIP: Record<string, "violet" | "emerald" | "cyan" | "amber" | "rose" | "zinc"> = { CLAUDE: "violet", GPT: "emerald", GEMINI: "cyan", QWEN: "amber", GLM: "rose", DEEPSEEK: "zinc" };

export function ModelCommandCenter() {
  const [registry, setRegistry] = useState<RegistryRow[]>([]);
  const [routing, setRouting] = useState<Routing[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const d = await fetch("/api/genesis/models").then((x) => x.json());
      setRegistry(d.registry ?? []); setRouting(d.routing ?? []); setUsage(d.usage ?? null);
    } catch { /* empty */ }
  };
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, []);

  const sync = async () => {
    setBusy(true);
    try {
      await fetch("/api/genesis/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "seed" }) });
      await fetch("/api/genesis/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "sync" }) });
      await load();
    } finally { setBusy(false); }
  };

  const active = registry.filter((r) => r.active);
  const leaderboard = [...active].sort((a, b) => (b.measuredWins - b.measuredLosses) - (a.measuredWins - a.measuredLosses)).slice(0, 6);

  return (
    <HudPanel
      title="Model Command Center"
      subtitle="multi-brain router — best available brain per task · measured, never assumed"
      icon={<Cpu className="w-3.5 h-3.5" />}
      accent="violet"
      right={
        <div className="flex items-center gap-2">
          <Chip variant="violet">{active.length} active brains</Chip>
          <button onClick={sync} disabled={busy} className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider px-2.5 py-1 rounded border border-violet-500/40 text-violet-300 hover:bg-violet-500/10 disabled:opacity-50">
            <RefreshCw className="w-3 h-3" /> {busy ? "syncing…" : "seed + sync"}
          </button>
        </div>
      }
    >
      {active.length === 0 ? <Empty text="registry empty — press SEED + SYNC" /> : (
        <div className="space-y-3">
          {/* usage strip */}
          {usage && usage.calls > 0 && (
            <div className="font-mono text-[10px] flex items-center gap-2 flex-wrap">
              <span className="text-zinc-500 uppercase tracking-wider">7d:</span>
              <Chip variant="cyan">{usage.calls} calls</Chip>
              <Chip variant="violet">{usage.totalTokens.toLocaleString()} tok</Chip>
              <Chip variant="emerald">~${usage.totalCostUsd.toFixed(4)} est</Chip>
              {usage.fallbackCalls > 0 && <Chip variant="amber">{usage.fallbackCalls} fallback</Chip>}
              {usage.retriedCalls > 0 && <Chip variant="amber">{usage.retriedCalls} retried</Chip>}
              <Chip variant={usage.calls - usage.okCalls > 0 ? "rose" : "zinc"}>{usage.calls - usage.okCalls} failures</Chip>
            </div>
          )}

          {/* registry table */}
          <div className="overflow-x-auto">
            <table className="w-full font-mono text-[10px]">
              <thead><tr className="text-zinc-500 uppercase tracking-wider text-left">
                <th className="py-1 pr-3">model</th><th className="pr-3">fam</th><th className="pr-3">reason</th><th className="pr-3">code</th><th className="pr-3">research</th><th className="pr-3 w-24">reliability</th><th className="pr-3">lat</th><th className="pr-3">w/l</th><th>$/1M</th>
              </tr></thead>
              <tbody>
                {active.slice(0, 10).map((r) => (
                  <tr key={r.modelId} className="border-t border-violet-500/10 text-zinc-300">
                    <td className="py-1 pr-3 truncate max-w-[190px]" title={r.modelId}>{r.modelId}</td>
                    <td className="pr-3"><Chip variant={FAM_CHIP[r.family] ?? "zinc"}>{r.family}</Chip></td>
                    <td className="pr-3">{r.reasoningTier}</td><td className="pr-3">{r.codingTier}</td><td className="pr-3">{r.researchTier}</td>
                    <td className="pr-3"><GenesisProgress value={r.reliability} accent={r.reliability >= 60 ? "emerald" : "amber"} /></td>
                    <td className="pr-3">{r.avgLatencyMs ? `${(r.avgLatencyMs / 1000).toFixed(1)}s` : "—"}</td>
                    <td className="pr-3">{r.measuredWins}/{r.measuredLosses}</td>
                    <td>{r.promptPrice}/{r.completionPrice}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* live routing */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5 font-mono text-[10px] border-t border-violet-500/10 pt-2">
            <div className="col-span-full text-zinc-500 uppercase tracking-wider">Live agent → brain routing (measured)</div>
            {routing.map((r) => (
              <div key={r.agent} className="flex items-center gap-2">
                <span className="text-zinc-300 w-28 truncate">{r.agent}</span>
                <span className="text-violet-300 truncate" title={r.models.join(" → ")}>{r.models[0] ?? "—"}</span>
              </div>
            ))}
          </div>

          {/* duel leaderboard */}
          {leaderboard.some((l) => l.measuredWins + l.measuredLosses > 0) && (
            <div className="font-mono text-[10px] border-t border-violet-500/10 pt-2">
              <span className="text-zinc-500 uppercase tracking-wider">Arena leaderboard: </span>
              {leaderboard.filter((l) => l.measuredWins + l.measuredLosses > 0).map((l) => `${l.modelId.split("/").pop()} ${l.measuredWins}W/${l.measuredLosses}L`).join(" · ")}
            </div>
          )}
        </div>
      )}
      <div className="mt-2 font-mono text-[9px] text-zinc-600 uppercase tracking-wider">reliability/latency/wins are MEASURED from real calls · run the models benchmark weekly via POST /api/genesis/models {"{action:'benchmark'}"}</div>
    </HudPanel>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="font-mono text-[10px] text-zinc-600 py-4 text-center uppercase tracking-wider">{text}</div>;
}
