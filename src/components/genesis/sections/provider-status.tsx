"use client";

/** LLM Provider Status panel: honest degradation made concrete — which gates run
 *  real reasoning vs a heuristic fallback right now, plus a self-test button.
 */

import { useEffect, useState } from "react";
import { BrainCircuit, Zap } from "lucide-react";
import { Chip, HudPanel } from "../primitives";

interface Status {
  provider: string; model: string | null; degraded: boolean; reasoningMode: string; summary: string; hint: string;
  llmGated: { gate: string; note: string; mode: string }[];
  procedural: { gate: string; note: string }[];
}
interface Check { ok: boolean; degraded: boolean; latencyMs: number; sample?: string; error?: string; model: string | null }

export function ProviderStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try { const d = await fetch("/api/genesis/provider").then((x) => x.json()); if (active) setStatus(d.status); } catch { /* empty */ }
    })();
    return () => { active = false; };
  }, []);

  const runTest = async () => {
    setTesting(true);
    try { const d = await fetch("/api/genesis/provider", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((x) => x.json()); setCheck(d.check); }
    finally { setTesting(false); }
  };

  if (!status) return null;

  return (
    <HudPanel
      title="LLM Provider"
      subtitle={status.summary}
      icon={<BrainCircuit className="w-3.5 h-3.5" />}
      accent={status.degraded ? "amber" : "emerald"}
      right={
        <div className="flex items-center gap-2">
          <Chip variant={status.degraded ? "amber" : "emerald"} dot>{status.reasoningMode}{status.model ? ` · ${status.model}` : ""}</Chip>
          <button onClick={runTest} disabled={testing} className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50">
            <Zap className="w-3 h-3" /> {testing ? "testing…" : "self-test"}
          </button>
        </div>
      }
    >
      {check && (
        <div className="mb-2 font-mono text-[10px]">
          <Chip variant={check.ok ? "emerald" : "amber"}>{check.ok ? `round-trip OK ${check.latencyMs}ms` : "no round-trip"}</Chip>{" "}
          <span className="text-zinc-500">{check.ok ? `sample: "${check.sample}"` : check.error}</span>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 font-mono text-[10px]">
        <div>
          <div className="text-zinc-500 uppercase tracking-wider mb-1">LLM-gated gates</div>
          {status.llmGated.map((g) => (
            <div key={g.gate} className="flex items-center gap-2">
              <Chip variant={g.mode === "LLM" ? "emerald" : "amber"}>{g.mode}</Chip>
              <span className="text-zinc-300">{g.gate}</span>
            </div>
          ))}
        </div>
        <div>
          <div className="text-zinc-500 uppercase tracking-wider mb-1">Procedural (deterministic by design)</div>
          {status.procedural.map((g) => (
            <div key={g.gate} className="flex items-center gap-2">
              <Chip variant="cyan">EXACT</Chip>
              <span className="text-zinc-400">{g.gate}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 font-mono text-[9px] text-zinc-600 uppercase tracking-wider">{status.hint}</div>
    </HudPanel>
  );
}
