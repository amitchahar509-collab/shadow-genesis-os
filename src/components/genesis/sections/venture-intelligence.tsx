"use client";

/** G13 — Venture Intelligence panel: the decision chain made visible.
 *  VentureRun pipeline → AEGIS claims → Venture analyses → Customer sims → Board decisions.
 *  Honesty labels (HEURISTIC / SIMULATION / UNSUPPORTED) are surfaced, never hidden.
 */

import { useCallback, useEffect, useState } from "react";
import { Factory, FlaskConical, Gavel, Play, RefreshCw, Scale, ShieldQuestion } from "lucide-react";
import { Chip, GenesisProgress, HudPanel } from "../primitives";
import { BenchmarkArena } from "./benchmark-arena";
import { AgentArena } from "./arena";
import { DemandGraph } from "./demand";
import { Marketplace } from "./marketplace";
import { WorldScanner } from "./world-scanner";
import { ProviderStatus } from "./provider-status";
import { Plugins } from "./plugins";

interface VentureRun {
  runId: string; status: string; focus: string | null; opportunityTitle: string | null;
  ventureScore: number; ventureVerdict: string | null; truthScore: number;
  customerRealityScore: number; buyRate: number; boardVerdict: string | null; boardConfidence: number;
  mode: string; createdAt: string;
}
interface BoardDecision { decisionId: string; topic: string; verdict: string; confidence: number; mode: string; tally: { GO?: number; NO_GO?: number; ABSTAIN?: number }; synthesis: string }
interface Claim { claimId: string; statement: string; verdict: string; truthScore: number; supportCount: number; contradictCount: number }
interface Analysis { analysisId: string; subject: string; ventureScore: number; verdict: string; mode: string }
interface Sim { simulationId: string; subject: string; personaCount: number; buyRate: number; realityScore: number; mode: string }

const verdictChip = (v: string | null): "emerald" | "amber" | "rose" | "zinc" =>
  v === "GO" || v === "INVEST" || v === "SUPPORTED" || v === "BUILT" ? "emerald"
  : v === "NO_GO" || v === "PASS" || v === "UNSUPPORTED" || v === "HALTED_NO_GO" || v === "FAILED" ? "rose"
  : v ? "amber" : "zinc";

export function VentureIntelligence() {
  const [runs, setRuns] = useState<VentureRun[]>([]);
  const [boards, setBoards] = useState<BoardDecision[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [sims, setSims] = useState<Sim[]>([]);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, b, c, v, s] = await Promise.all([
        fetch("/api/genesis/company?limit=10").then((x) => x.json()),
        fetch("/api/genesis/boardroom?limit=8").then((x) => x.json()),
        fetch("/api/genesis/aegis?limit=8").then((x) => x.json()),
        fetch("/api/genesis/venture?limit=8").then((x) => x.json()),
        fetch("/api/genesis/customers?limit=8").then((x) => x.json()),
      ]);
      setRuns(r.runs ?? []);
      setBoards(b.decisions ?? []);
      setClaims(c.claims ?? []);
      setAnalyses(v.analyses ?? []);
      setSims(s.simulations ?? []);
    } catch { /* panels render empty */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const createCompany = async () => {
    setLaunching(true);
    try {
      await fetch("/api/genesis/company", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      setTimeout(load, 1500);
    } finally { setLaunching(false); }
  };

  return (
    <div className="space-y-4">
      {/* ===== LLM provider status (honest degradation) ===== */}
      <ProviderStatus />

      {/* ===== World scanner (discovery) ===== */}
      <WorldScanner />

      {/* ===== Autonomous pipeline runs ===== */}
      <HudPanel
        title="Autonomous Venture Pipeline"
        subtitle="discover → aegis → venture → customers → board → build → operate"
        icon={<Factory className="w-3.5 h-3.5" />}
        accent="emerald"
        right={
          <button
            onClick={createCompany}
            disabled={launching}
            className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider px-2.5 py-1 rounded border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
          >
            <Play className="w-3 h-3" /> {launching ? "launching…" : "create company (no idea)"}
          </button>
        }
      >
        {loading ? <Empty text="loading…" /> : runs.length === 0 ? <Empty text="no runs yet — press CREATE COMPANY" /> : (
          <div className="overflow-x-auto">
            <table className="w-full font-mono text-[10px]">
              <thead>
                <tr className="text-zinc-500 uppercase tracking-wider text-left">
                  <th className="py-1.5 pr-3">run</th><th className="pr-3">opportunity</th><th className="pr-3">venture</th>
                  <th className="pr-3">truth</th><th className="pr-3">customer (sim)</th><th className="pr-3">board</th><th className="pr-3">outcome</th><th>mode</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.runId} className="border-t border-emerald-500/10 text-zinc-300">
                    <td className="py-1.5 pr-3 text-emerald-400">{r.runId}</td>
                    <td className="pr-3 max-w-[220px] truncate" title={r.opportunityTitle ?? undefined}>{r.opportunityTitle ?? r.focus ?? "—"}</td>
                    <td className="pr-3">{r.ventureScore}/100 <span className="text-zinc-500">{r.ventureVerdict}</span></td>
                    <td className="pr-3"><span className={r.truthScore < 25 ? "text-rose-400" : r.truthScore < 60 ? "text-amber-400" : "text-emerald-400"}>{r.truthScore}%</span></td>
                    <td className="pr-3">{r.customerRealityScore}/100 <span className="text-zinc-500">({r.buyRate}% buy)</span></td>
                    <td className="pr-3"><Chip variant={verdictChip(r.boardVerdict)}>{r.boardVerdict ?? "—"} {r.boardConfidence ? `${r.boardConfidence}%` : ""}</Chip></td>
                    <td className="pr-3"><Chip variant={verdictChip(r.status)}>{r.status}</Chip></td>
                    <td><Chip variant={r.mode === "HEURISTIC" ? "amber" : "cyan"}>{r.mode}</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </HudPanel>

      {/* ===== The four gates ===== */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <HudPanel title="AEGIS Truth Engine" subtitle="no unsupported confidence" icon={<ShieldQuestion className="w-3.5 h-3.5" />} accent="cyan">
          {claims.length === 0 ? <Empty text="no claims recorded" /> : (
            <ul className="space-y-2">
              {claims.map((c) => (
                <li key={c.claimId} className="font-mono text-[10px] text-zinc-300 flex items-center gap-2">
                  <Chip variant={verdictChip(c.verdict)}>{c.verdict}</Chip>
                  <span className="flex-1 truncate" title={c.statement}>{c.statement}</span>
                  <span className="text-zinc-500 shrink-0">{c.truthScore}% · {c.supportCount}↑/{c.contradictCount}↓</span>
                </li>
              ))}
            </ul>
          )}
        </HudPanel>

        <HudPanel title="Venture Analyst" subtitle="judge like a VC — VENTURE_SCORE" icon={<Scale className="w-3.5 h-3.5" />} accent="violet">
          {analyses.length === 0 ? <Empty text="no analyses yet" /> : (
            <ul className="space-y-2.5">
              {analyses.map((a) => (
                <li key={a.analysisId} className="font-mono text-[10px] text-zinc-300">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-violet-300">{a.analysisId}</span>
                    <span className="flex-1 truncate" title={a.subject}>{a.subject}</span>
                    <Chip variant={verdictChip(a.verdict)}>{a.verdict}</Chip>
                    <Chip variant={a.mode === "HEURISTIC" ? "amber" : "cyan"}>{a.mode}</Chip>
                  </div>
                  <GenesisProgress value={a.ventureScore} accent="violet" />
                </li>
              ))}
            </ul>
          )}
        </HudPanel>

        <HudPanel title="Customer Simulator" subtitle="SIMULATION — procedurally generated personas, not real users" icon={<FlaskConical className="w-3.5 h-3.5" />} accent="amber">
          {sims.length === 0 ? <Empty text="no simulations yet" /> : (
            <ul className="space-y-2">
              {sims.map((s) => (
                <li key={s.simulationId} className="font-mono text-[10px] text-zinc-300 flex items-center gap-2">
                  <span className="text-amber-300">{s.simulationId}</span>
                  <span className="flex-1 truncate" title={s.subject}>{s.subject}</span>
                  <span className="text-zinc-400">{s.personaCount}p · {s.buyRate}% buy</span>
                  <span className="text-amber-400">{s.realityScore}/100</span>
                  <Chip variant="amber">SIMULATION</Chip>
                </li>
              ))}
            </ul>
          )}
        </HudPanel>

        <HudPanel title="AI Boardroom" subtitle="nine seats · no silent decisions" icon={<Gavel className="w-3.5 h-3.5" />} accent="rose">
          {boards.length === 0 ? <Empty text="no board decisions yet" /> : (
            <ul className="space-y-2.5">
              {boards.map((b) => (
                <li key={b.decisionId} className="font-mono text-[10px] text-zinc-300">
                  <div className="flex items-center gap-2">
                    <Chip variant={verdictChip(b.verdict)}>{b.verdict} {b.confidence}%</Chip>
                    <span className="flex-1 truncate" title={b.topic}>{b.topic}</span>
                    <span className="text-zinc-500 shrink-0">{b.tally?.GO ?? 0}GO/{b.tally?.NO_GO ?? 0}NO/{b.tally?.ABSTAIN ?? 0}AB</span>
                  </div>
                  <div className="text-zinc-500 truncate mt-0.5" title={b.synthesis}>{b.synthesis}</div>
                </li>
              ))}
            </ul>
          )}
        </HudPanel>
      </div>

      {/* ===== Demand matching ===== */}
      <DemandGraph />

      {/* ===== App marketplace ===== */}
      <Marketplace />

      {/* ===== Plugin / skill marketplace ===== */}
      <Plugins />

      {/* ===== Agent competition ===== */}
      <AgentArena />

      {/* ===== Self-measurement ===== */}
      <BenchmarkArena />

      <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-wider text-zinc-600">
        <RefreshCw className="w-3 h-3" /> auto-refreshes every 15s · amber chips = heuristic/simulated (no LLM key) — never presented as real data
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="font-mono text-[10px] text-zinc-600 py-4 text-center uppercase tracking-wider">{text}</div>;
}
