"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Boxes,
  BrainCircuit,
  Cpu,
  Database,
  GitBranch,
  LayoutDashboard,
  Radar,
  Repeat,
  ShieldCheck,
  Terminal,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GenesisSummary } from "@/lib/genesis/types";
import { LiveClock, UptimeCounter, Chip } from "./primitives";
import { CommandCenter } from "./sections/command-center";
import { TaskGraph } from "./sections/task-graph";
import { Departments } from "./sections/departments";
import { MemoryBanks } from "./sections/memory-banks";
import { OperationalLoops } from "./sections/operational-loops";
import { GenesisStateView } from "./sections/genesis-state";

type TabKey =
  | "command"
  | "tasks"
  | "departments"
  | "memory"
  | "loops"
  | "state";

const NAV: { key: TabKey; label: string; icon: React.ReactNode; desc: string }[] = [
  { key: "command", label: "Command Center", icon: <LayoutDashboard className="w-3.5 h-3.5" />, desc: "overview" },
  { key: "tasks", label: "Task Graph", icon: <Boxes className="w-3.5 h-3.5" />, desc: "execution" },
  { key: "departments", label: "Departments", icon: <Cpu className="w-3.5 h-3.5" />, desc: "agents" },
  { key: "memory", label: "Memory Banks", icon: <Database className="w-3.5 h-3.5" />, desc: "knowledge" },
  { key: "loops", label: "Operational Loops", icon: <Repeat className="w-3.5 h-3.5" />, desc: "automation" },
  { key: "state", label: "Genesis State", icon: <Radar className="w-3.5 h-3.5" />, desc: "mission" },
];

const LOOP_STAGES = ["DISCOVER", "VALIDATE", "DESIGN", "BUILD", "TEST", "DEPLOY", "MEASURE", "IMPROVE", "REPEAT"];

export function GenesisShell() {
  const [tab, setTab] = useState<TabKey>("command");
  const [summary, setSummary] = useState<GenesisSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  const loadSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/genesis/summary", { cache: "no-store" });
      if (!res.ok) throw new Error(`summary ${res.status}`);
      const data = (await res.json()) as GenesisSummary;
      setSummary(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSummary();
    const t = setInterval(loadSummary, 20000);
    return () => clearInterval(t);
  }, [loadSummary]);

  const activeAgents = summary?.state.active_agents ?? "0";
  const modelCost = summary?.state.model_cost_today ?? "0";
  const tokens = summary?.state.tokens_today ?? "0";
  const phase = summary?.state.phase ?? "—";
  const cycle = summary?.state.cycle ?? "0";
  const bootEpoch = summary?.state.boot_epoch ?? new Date().toISOString();

  return (
    <div className="genesis-bg min-h-screen flex flex-col text-zinc-200">
      {/* ===== HEADER ===== */}
      <header className="sticky top-0 z-40 border-b border-emerald-500/15 bg-[#06070b]/85 backdrop-blur-xl">
        <div className="flex items-center gap-3 px-3 sm:px-4 h-14">
          {/* mobile nav toggle */}
          <button
            onClick={() => setNavOpen((v) => !v)}
            className="lg:hidden p-1.5 rounded border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/10"
            aria-label="toggle navigation"
          >
            <Terminal className="w-4 h-4" />
          </button>

          {/* Logo */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="relative w-7 h-7 rounded-sm border border-emerald-500/40 flex items-center justify-center bg-emerald-500/5">
              <TriangleAlert className="w-3.5 h-3.5 text-emerald-400" />
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.9)] flicker" />
            </div>
            <div className="leading-none">
              <div className="font-mono text-[13px] font-bold tracking-[0.22em] text-zinc-100">
                SHADOW<span className="text-emerald-400"> GENESIS</span>
              </div>
              <div className="font-mono text-[9px] tracking-[0.32em] text-zinc-500 uppercase">
                autonomous ai co · os
              </div>
            </div>
          </div>

          <div className="hidden md:block h-6 w-px bg-emerald-500/15 mx-1" />

          {/* System status chips */}
          <div className="hidden md:flex items-center gap-2">
            <Chip variant="emerald" dot>SYSTEM ONLINE</Chip>
            <Chip variant="cyan">PHASE · {phase}</Chip>
            <Chip variant="amber">CYCLE {cycle}</Chip>
          </div>

          {/* Right cluster */}
          <div className="ml-auto flex items-center gap-3 sm:gap-4">
            <div className="hidden sm:flex items-center gap-3 font-mono text-[10px] text-zinc-400">
              <span className="flex items-center gap-1">
                <BrainCircuit className="w-3 h-3 text-emerald-400" />
                <span className="text-zinc-500">AGENTS</span>
                <span className="text-emerald-400 font-semibold">{activeAgents}</span>
              </span>
              <span className="flex items-center gap-1">
                <Cpu className="w-3 h-3 text-cyan-400" />
                <span className="text-zinc-500">COST</span>
                <span className="text-cyan-400 font-semibold">${modelCost}</span>
              </span>
              <span className="hidden lg:flex items-center gap-1">
                <Activity className="w-3 h-3 text-violet-400" />
                <span className="text-zinc-500">TOK</span>
                <span className="text-violet-300 font-semibold">{Number(tokens).toLocaleString()}</span>
              </span>
            </div>
            <div className="hidden sm:flex flex-col items-end leading-none">
              <LiveClock className="text-[13px] text-emerald-400 glow-emerald" />
              <span className="text-[9px] font-mono text-zinc-600 flex items-center gap-1 mt-0.5">
                <span className="w-1 h-1 rounded-full bg-emerald-400" />
                UPTIME <UptimeCounter startIso={bootEpoch} className="text-zinc-400" />
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* ===== BODY: sidebar + main ===== */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside
          className={cn(
            "fixed lg:sticky lg:top-14 top-14 left-0 z-30 w-52 shrink-0 h-[calc(100vh-3.5rem)]",
            "border-r border-emerald-500/10 bg-[#07080d]/90 backdrop-blur-xl",
            "transition-transform duration-200",
            navOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
          )}
        >
          <nav className="flex flex-col p-2 gap-0.5 sticky top-0">
            {NAV.map((item) => {
              const active = tab === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => {
                    setTab(item.key);
                    setNavOpen(false);
                  }}
                  className={cn(
                    "nav-item flex items-center gap-2.5 px-3 py-2 rounded-sm text-left",
                    active ? "nav-active" : "text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  <span className={cn(active ? "text-emerald-400" : "text-zinc-500")}>
                    {item.icon}
                  </span>
                  <span className="flex flex-col leading-none">
                    <span className="font-mono text-[11px] tracking-[0.1em] uppercase">{item.label}</span>
                    <span className="font-mono text-[9px] text-zinc-600 tracking-wide mt-0.5">
                      {item.desc}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>

          {/* Sidebar footer mini-status */}
          <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-emerald-500/10">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="w-3 h-3 text-emerald-400" />
              <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">
                self-correction
              </span>
              <span className="ml-auto font-mono text-[10px] text-emerald-400">92%</span>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <GitBranch className="w-3 h-3 text-cyan-400" />
              <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">
                git checkpoint
              </span>
              <span className="ml-auto font-mono text-[10px] text-cyan-400">v0.7.3</span>
            </div>
            <div className="flex items-center gap-2">
              <Radar className="w-3 h-3 text-amber-400" />
              <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">
                security loop
              </span>
              <span className="ml-auto font-mono text-[10px] text-amber-400">2 MED</span>
            </div>
          </div>
        </aside>

        {/* overlay for mobile */}
        {navOpen && (
          <div
            className="fixed inset-0 z-20 bg-black/50 lg:hidden"
            onClick={() => setNavOpen(false)}
          />
        )}

        {/* Main */}
        <main className="flex-1 min-w-0 min-h-0 overflow-x-hidden">
          {loading ? (
            <BootScreen />
          ) : error ? (
            <ErrorScreen error={error} onRetry={loadSummary} />
          ) : summary ? (
            <div className="p-3 sm:p-5 space-y-4">
              {tab === "command" && <CommandCenter summary={summary} onRefresh={loadSummary} />}
              {tab === "tasks" && <TaskGraph summary={summary} />}
              {tab === "departments" && <Departments summary={summary} />}
              {tab === "memory" && <MemoryBanks initial={[]} />}
              {tab === "loops" && <OperationalLoops loops={summary.loops} />}
              {tab === "state" && <GenesisStateView summary={summary} />}
            </div>
          ) : null}
        </main>
      </div>

      {/* ===== STICKY FOOTER ===== */}
      <footer className="sticky bottom-0 z-40 mt-auto border-t border-emerald-500/15 bg-[#06070b]/90 backdrop-blur-xl">
        <div className="flex items-center gap-3 px-3 sm:px-4 h-9">
          <div className="flex items-center gap-1.5 shrink-0">
            <Repeat className="w-3 h-3 text-emerald-400" />
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500 hidden sm:inline">
              execution loop
            </span>
          </div>
          <div className="flex-1 overflow-hidden">
            <div className="marquee-track">
              {[...LOOP_STAGES, ...LOOP_STAGES].map((stage, i) => (
                <span key={i} className="inline-flex items-center gap-2 px-3 font-mono text-[10px] tracking-[0.18em] uppercase">
                  <span className={cn("w-1 h-1 rounded-full", i % 3 === 0 ? "bg-emerald-400" : i % 3 === 1 ? "bg-cyan-400" : "bg-amber-400")} />
                  <span className="text-zinc-300">{stage}</span>
                  <span className="text-emerald-500/40">→</span>
                </span>
              ))}
            </div>
          </div>
          <div className="hidden md:flex items-center gap-2 shrink-0 font-mono text-[9px] text-zinc-500 uppercase tracking-wider">
            <span className="text-emerald-400">●</span> never stop at ideas
          </div>
        </div>
      </footer>
    </div>
  );
}

function BootScreen() {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    const msgs = [
      "[ GENESIS ] mounting genesis state tracker...",
      "[ GENESIS ] resolving task graph dependencies...",
      "[ GENESIS ] spawning department agents...",
      "[ GENESIS ] warming model orchestration router...",
      "[ GENESIS ] connecting live activity feed...",
      "[ GENESIS ] command center ready.",
    ];
    let i = 0;
    const t = setInterval(() => {
      setLines((p) => [...p, msgs[i]]);
      i++;
      if (i >= msgs.length) clearInterval(t);
    }, 180);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="genesis-bg min-h-[60vh] flex items-center justify-center p-6">
      <div className="genesis-panel rounded-md p-6 w-full max-w-md font-mono text-xs space-y-1.5">
        <div className="text-emerald-400 glow-emerald mb-3 tracking-[0.2em]">SHADOW GENESIS OS · BOOT</div>
        {lines.map((l, i) => (
          <div key={i} className="text-zinc-400">
            <span className="text-emerald-500/60">›</span> {l}
          </div>
        ))}
        <div className="text-zinc-500">
          <span className="text-emerald-500/60">›</span> <span className="type-cursor" />
        </div>
      </div>
    </div>
  );
}

function ErrorScreen({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="genesis-bg min-h-[60vh] flex items-center justify-center p-6">
      <div className="genesis-panel rounded-md p-6 w-full max-w-md text-center">
        <TriangleAlert className="w-8 h-8 text-rose-400 mx-auto mb-3" />
        <div className="font-mono text-sm text-rose-400 mb-1">SYSTEM FAULT</div>
        <div className="font-mono text-xs text-zinc-400 mb-4">{error}</div>
        <button
          onClick={onRetry}
          className="font-mono text-[11px] uppercase tracking-wider px-4 py-2 rounded border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
        >
          retry boot
        </button>
      </div>
    </div>
  );
}
