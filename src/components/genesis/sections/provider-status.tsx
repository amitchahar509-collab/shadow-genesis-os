"use client";

/** LLM Provider Status panel: honest degradation made concrete — which gates run
 *  real reasoning vs a heuristic fallback right now, plus a self-test button.
 */

import { useEffect, useState } from "react";
import { BrainCircuit, Zap } from "lucide-react";
import { Chip, HudPanel } from "../primitives";

interface RouteHop { provider: string; model: string; available: boolean }
interface Status {
  provider: string; providers: string[]; model: string | null; degraded: boolean; reasoningMode: string; summary: string; hint: string;
  llmGated: { gate: string; note: string; mode: string }[];
  procedural: { gate: string; note: string }[];
  routing: { agent: string; capability: string; chain: RouteHop[] }[];
}
interface Check { ok: boolean; degraded: boolean; latencyMs: number; sample?: string; error?: string; model: string | null }
interface Usage { calls: number; okCalls: number; fallbackCalls: number; totalTokens: number; totalCostUsd: number; byProvider: Record<string, { calls: number; tokens: number; costUsd: number }> }

const CAP_CHIP: Record<string, "rose" | "cyan" | "violet" | "amber" | "zinc"> = { REASONING: "rose", CODING: "cyan", LONG_CONTEXT: "violet", CHEAP: "amber", DEFAULT: "zinc" };

export function ProviderStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [testing, setTesting] = useState(false);
  const [showRouting, setShowRouting] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [s, u] = await Promise.all([
          fetch("/api/genesis/provider").then((x) => x.json()),
          fetch("/api/genesis/provider?usage=1").then((x) => x.json()),
        ]);
        if (active) { setStatus(s.status); setUsage(u.usage); }
      } catch { /* empty */ }
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
          {(status.providers ?? []).map((p) => <Chip key={p} variant="emerald" dot>{p}</Chip>)}
          {status.degraded && <Chip variant="amber" dot>HEURISTIC</Chip>}
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
      {/* ===== token usage + estimated cost ===== */}
      {usage && usage.calls > 0 && (
        <div className="mt-3 pt-2 border-t border-emerald-500/10 font-mono text-[10px] flex items-center gap-3 flex-wrap">
          <span className="text-zinc-500 uppercase tracking-wider">Router usage (30d):</span>
          <Chip variant="cyan">{usage.calls} calls</Chip>
          <Chip variant="violet">{usage.totalTokens.toLocaleString()} tok</Chip>
          <Chip variant="emerald">~${usage.totalCostUsd.toFixed(4)} <span className="text-zinc-500">est.</span></Chip>
          {usage.fallbackCalls > 0 && <Chip variant="amber">{usage.fallbackCalls} fallback</Chip>}
          <span className="text-zinc-600">{Object.entries(usage.byProvider).map(([p, v]) => `${p}: ${v.tokens.toLocaleString()}tok`).join(" · ")}</span>
        </div>
      )}

      {/* ===== per-agent routing table ===== */}
      <button onClick={() => setShowRouting((v) => !v)} className="mt-2 font-mono text-[9px] uppercase tracking-wider text-emerald-400/80 hover:text-emerald-300">
        {showRouting ? "▾" : "▸"} per-agent model routing ({status.routing?.length ?? 0} agents)
      </button>
      {showRouting && (
        <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5 font-mono text-[10px]">
          {(status.routing ?? []).map((r) => (
            <div key={r.agent} className="flex items-center gap-2">
              <span className="text-zinc-300 w-24 truncate">{r.agent}</span>
              <Chip variant={CAP_CHIP[r.capability] ?? "zinc"}>{r.capability}</Chip>
              <span className="text-zinc-500 truncate" title={r.chain.map((h) => `${h.provider}:${h.model}${h.available ? "" : " (no key)"}`).join(" → ")}>
                {(r.chain.find((h) => h.available)?.model) ?? r.chain[0]?.model} <span className="text-zinc-700">→ {r.chain.length} hops</span>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 font-mono text-[9px] text-zinc-600 uppercase tracking-wider">{status.hint}</div>
    </HudPanel>
  );
}
