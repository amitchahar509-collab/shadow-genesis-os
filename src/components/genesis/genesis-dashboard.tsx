"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity as ActivityIcon,
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
  Rocket,
  Bot,
  CheckCircle2,
  Gauge,
  Scale,
  Server,
  Network,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LiveClock, UptimeCounter, Chip } from "./primitives";
import { ActivityFeed } from "./activity-feed";
import { VentureIntelligence } from "./sections/venture-intelligence";
import { MissionControl } from "./sections/mission-control";
import { useToast } from "@/hooks/use-toast";

type TabKey =
  | "command"
  | "venture"
  | "control"
  | "missions"
  | "agents"
  | "tasks"
  | "memory"
  | "messages"
  | "security"
  | "observability"
  | "sandboxes"
  | "state";

const NAV: { key: TabKey; label: string; icon: React.ReactNode; desc: string }[] = [
  { key: "command", label: "Command Center", icon: <LayoutDashboard className="w-3.5 h-3.5" />, desc: "overview" },
  { key: "venture", label: "Venture Intelligence", icon: <Scale className="w-3.5 h-3.5" />, desc: "pipeline · gates" },
  { key: "control", label: "Mission Control", icon: <ShieldCheck className="w-3.5 h-3.5" />, desc: "approvals · operator" },
  { key: "missions", label: "Missions", icon: <Rocket className="w-3.5 h-3.5" />, desc: "autonomous" },
  { key: "agents", label: "Agents", icon: <Bot className="w-3.5 h-3.5" />, desc: "13 agents" },
  { key: "tasks", label: "Tasks", icon: <Boxes className="w-3.5 h-3.5" />, desc: "execution" },
  { key: "memory", label: "Memory", icon: <Database className="w-3.5 h-3.5" />, desc: "knowledge" },
  { key: "messages", label: "Messages", icon: <Network className="w-3.5 h-3.5" />, desc: "collab" },
  { key: "security", label: "Security", icon: <ShieldCheck className="w-3.5 h-3.5" />, desc: "findings" },
  { key: "observability", label: "Observability", icon: <Gauge className="w-3.5 h-3.5" />, desc: "metrics" },
  { key: "sandboxes", label: "Sandboxes", icon: <Server className="w-3.5 h-3.5" />, desc: "runtime" },
  { key: "state", label: "Genesis State", icon: <Radar className="w-3.5 h-3.5" />, desc: "system" },
];

const LOOP_STAGES = ["DISCOVER", "VALIDATE", "DESIGN", "BUILD", "TEST", "DEPLOY", "MEASURE", "IMPROVE", "REPEAT"];

export function GenesisDashboard() {
  const [tab, setTab] = useState<TabKey>("command");
  const [summary, setSummary] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [missions, setMissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [navOpen, setNavOpen] = useState(false);
  const { toast } = useToast();

  const loadSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/genesis/summary", { cache: "no-store" });
      if (!res.ok) throw new Error(`summary ${res.status}`);
      const data = await res.json();
      setSummary(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/genesis/orchestrator/status", { cache: "no-store" });
      if (res.ok) setStatus((await res.json()).status);
    } catch {}
  }, []);

  const loadMissions = useCallback(async () => {
    try {
      const res = await fetch("/api/genesis/orchestrator/missions", { cache: "no-store" });
      if (res.ok) setMissions((await res.json()).missions ?? []);
    } catch {}
  }, []);

  const [provider, setProvider] = useState<{ degraded: boolean; reasoningMode: string; model: string | null; provider: string } | null>(null);
  const loadProvider = useCallback(async () => {
    try {
      const res = await fetch("/api/genesis/provider", { cache: "no-store" });
      if (res.ok) setProvider((await res.json()).status);
    } catch {}
  }, []);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSummary();
    loadStatus();
    loadMissions();
    loadProvider();
    const t1 = setInterval(loadSummary, 20000);
    const t2 = setInterval(loadStatus, 5000);
    const t3 = setInterval(loadMissions, 5000);
    return () => { clearInterval(t1); clearInterval(t2); clearInterval(t3); };
  }, [loadSummary, loadStatus, loadMissions]);

  const state = summary?.state ?? {};
  const activeMissions = missions.filter((m) => m.status === "RUNNING").length;

  return (
    <div className="genesis-bg min-h-screen flex flex-col text-zinc-200">
      {/* ===== HEADER ===== */}
      <header className="sticky top-0 z-40 border-b border-emerald-500/15 bg-[#06070b]/85 backdrop-blur-xl">
        <div className="flex items-center gap-3 px-3 sm:px-4 h-14">
          <button onClick={() => setNavOpen((v) => !v)} className="lg:hidden p-1.5 rounded border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/10" aria-label="toggle navigation">
            <Terminal className="w-4 h-4" />
          </button>

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
                autonomous ai org · v4
              </div>
            </div>
          </div>

          <div className="hidden md:block h-6 w-px bg-emerald-500/15 mx-1" />

          <div className="hidden md:flex items-center gap-2">
            <Chip variant="emerald" dot>SYSTEM ONLINE</Chip>
            <Chip variant="cyan">{activeMissions} ACTIVE MISSIONS</Chip>
            <Chip variant="amber">{status?.queued ?? 0} QUEUED</Chip>
            {provider && (
              <Chip variant={provider.degraded ? "amber" : "emerald"} dot>
                {provider.degraded ? "LLM DEGRADED · HEURISTIC" : `LLM · ${provider.model ?? provider.provider}`}
              </Chip>
            )}
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden sm:block text-right">
              <LiveClock />
              {state.boot_epoch && <UptimeCounter startIso={state.boot_epoch} />}
            </div>
          </div>
        </div>
      </header>

      {/* ===== BODY ===== */}
      <div className="flex-1 flex">
        {/* Sidebar */}
        <aside className={cn("w-48 shrink-0 border-r border-emerald-500/10 bg-[#06070b]/60 backdrop-blur-sm", "lg:block", navOpen ? "block" : "hidden")}>
          <nav className="sticky top-14 p-2 space-y-0.5">
            {NAV.map((item) => {
              const active = tab === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => { setTab(item.key); setNavOpen(false); if (typeof window !== "undefined") window.scrollTo(0, 0); }}
                  className={cn(
                    "w-full flex items-center gap-2 px-2.5 py-2 rounded text-left transition-all",
                    active
                      ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
                      : "border border-transparent text-zinc-400 hover:bg-emerald-500/5 hover:text-zinc-200"
                  )}
                >
                  <span className={cn(active ? "text-emerald-400" : "text-zinc-500")}>{item.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[11px] font-semibold tracking-wide leading-tight">{item.label}</div>
                    <div className="font-mono text-[8px] text-zinc-600 uppercase tracking-wider leading-tight">{item.desc}</div>
                  </div>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 p-3 sm:p-4 space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-20">
              <div className="font-mono text-emerald-400 text-xs tracking-widest animate-pulse">INITIALIZING SHADOW GENESIS…</div>
            </div>
          )}
          {error && (
            <div className="genesis-panel p-4 border-rose-500/30">
              <div className="font-mono text-rose-400 text-xs">SYSTEM ERROR: {error}</div>
            </div>
          )}
          {!loading && !error && (
            <>
              {tab === "command" && <CommandCenter summary={summary} status={status} missions={missions} onRefresh={loadSummary} />}
              {tab === "venture" && <VentureIntelligence />}
              {tab === "control" && <MissionControl />}
              {tab === "missions" && <MissionsView missions={missions} onRefresh={loadMissions} />}
              {tab === "agents" && <AgentsView />}
              {tab === "tasks" && <TasksView summary={summary} />}
              {tab === "memory" && <MemoryView />}
              {tab === "messages" && <MessagesView />}
              {tab === "security" && <SecurityView />}
              {tab === "observability" && <ObservabilityView />}
              {tab === "sandboxes" && <SandboxesView />}
              {tab === "state" && <GenesisStateView summary={summary} />}
            </>
          )}
        </main>
      </div>

      {/* ===== FOOTER ===== */}
      <footer className="sticky bottom-0 z-30 border-t border-emerald-500/15 bg-[#06070b]/85 backdrop-blur-xl">
        <div className="flex items-center gap-2 px-3 sm:px-4 h-8 overflow-hidden">
          <div className="flex items-center gap-2 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flicker" />
            <span className="font-mono text-[9px] tracking-[0.25em] text-emerald-400 uppercase">loop</span>
          </div>
          <div className="flex-1 overflow-hidden">
            <div className="flex gap-6 animate-marquee whitespace-nowrap">
              {[...LOOP_STAGES, ...LOOP_STAGES, ...LOOP_STAGES].map((stage, i) => (
                <span key={i} className="font-mono text-[9px] tracking-[0.3em] text-zinc-500 uppercase">
                  ▸ {stage}
                </span>
              ))}
            </div>
          </div>
        </div>
      </footer>

      <style jsx global>{`
        @keyframes marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-33.33%); } }
        .animate-marquee { animation: marquee 40s linear infinite; }
      `}</style>
    </div>
  );
}

// ============== Command Center ==============
function CommandCenter({ summary, status, missions, onRefresh }: { summary: any; status: any; missions: any[]; onRefresh: () => void; }) {
  const [goal, setGoal] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);

  const submit = async () => {
    if (!goal.trim() || submitting) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/genesis/v4/dispatch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal: goal.trim(), background: true }),
      });
      const data = await res.json();
      setResult(data);
      setGoal("");
      onRefresh();
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  const activeMissions = missions.filter((m) => m.status === "RUNNING");
  const recentMissions = missions.slice(0, 5);

  return (
    <div className="space-y-4">
      {/* Mission Input */}
      <div className="genesis-panel p-4">
        <div className="section-h">▸ MISSION INPUT — "Build my idea"</div>
        <div className="flex flex-col sm:flex-row gap-2 mt-2">
          <input
            className="input-genesis flex-1"
            placeholder="e.g. build a markdown-to-html converter, build a todo CLI, build a URL shortener API…"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            disabled={submitting}
          />
          <button onClick={submit} disabled={submitting || !goal.trim()} className="btn-genesis shrink-0">
            {submitting ? "DISPATCHING…" : "▸ DISPATCH MISSION"}
          </button>
        </div>
        {result?.mission && (
          <div className="mt-2 text-[11px] font-mono text-emerald-400">
            ✓ Mission {result.mission.missionId} dispatched — running in background. Track it in the Missions tab.
          </div>
        )}
        {result?.error && (
          <div className="mt-2 text-[11px] font-mono text-rose-400">✗ {result.error}</div>
        )}
        <div className="mt-2 text-[9px] font-mono text-zinc-600">
          CEO decomposes goal → RESEARCH → ARCHITECT → ENGINEERING → QUALITY → SECURITY → DEPLOYMENT → GROWTH. Real execution. Real artifacts.
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <KpiStat label="Active Missions" value={activeMissions.length} icon={<Rocket className="w-3 h-3" />} accent="emerald" />
        <KpiStat label="Queued Tasks" value={status?.queued ?? 0} icon={<Boxes className="w-3 h-3" />} accent="cyan" />
        <KpiStat label="In Progress" value={status?.inProgress ?? 0} icon={<ActivityIcon className="w-3 h-3" />} accent="amber" />
        <KpiStat label="Done Today" value={status?.doneToday ?? 0} icon={<CheckCircle2 className="w-3 h-3" />} accent="emerald" />
        <KpiStat label="Agents" value={13} icon={<Bot className="w-3 h-3" />} accent="violet" />
        <KpiStat label="Failed Today" value={status?.failedToday ?? 0} icon={<TriangleAlert className="w-3 h-3" />} accent="rose" />
      </div>

      {/* Active Missions + Live Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="genesis-panel p-3">
          <div className="section-h">▸ ACTIVE MISSIONS</div>
          {activeMissions.length === 0 ? (
            <div className="text-[11px] font-mono text-zinc-500 py-4 text-center">No active missions. Dispatch one above.</div>
          ) : (
            <div className="space-y-2 mt-2 max-h-[300px] overflow-y-auto">
              {activeMissions.map((m) => (
                <div key={m.missionId} className="border border-emerald-500/20 rounded p-2 bg-black/30">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-emerald-400">{m.missionId}</span>
                    <span className="font-mono text-[9px] text-amber-400 uppercase">{m.status}</span>
                  </div>
                  <div className="font-mono text-[11px] text-zinc-300 mt-1 truncate">{m.goal}</div>
                </div>
              ))}
            </div>
          )}
          {recentMissions.length > 0 && (
            <>
              <div className="section-h mt-3">▸ RECENT</div>
              <div className="space-y-1 mt-1">
                {recentMissions.slice(0, 3).map((m) => (
                  <div key={m.missionId} className="flex items-center gap-2 text-[10px] font-mono">
                    <span className={cn("w-1.5 h-1.5 rounded-full", m.status === "COMPLETE" ? "bg-emerald-400" : m.status === "FAILED" ? "bg-rose-400" : "bg-amber-400")} />
                    <span className="text-zinc-500">{m.missionId}</span>
                    <span className="text-zinc-300 truncate flex-1">{m.goal}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="genesis-panel p-3">
          <div className="section-h">▸ LIVE ACTIVITY FEED</div>
          <ActivityFeed initial={summary?.recentActivity ?? []} maxHeight="max-h-[300px]" />
        </div>
      </div>
    </div>
  );
}

// ============== Missions View ==============
function MissionsView({ missions, onRefresh }: { missions: any[]; onRefresh: () => void; }) {
  return (
    <div className="space-y-3">
      <div className="section-h">▸ MISSIONS ({missions.length})</div>
      <div className="space-y-2">
        {missions.length === 0 ? (
          <div className="text-[11px] font-mono text-zinc-500 py-8 text-center">No missions yet. Go to Command Center to dispatch one.</div>
        ) : (
          missions.map((m) => (
            <div key={m.missionId} className="genesis-panel p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-[11px] text-emerald-400">{m.missionId}</span>
                <span className={cn("font-mono text-[9px] uppercase px-1.5 py-0.5 rounded", m.status === "RUNNING" ? "bg-amber-500/20 text-amber-400" : m.status === "COMPLETE" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400")}>{m.status}</span>
                <span className="font-mono text-[9px] text-zinc-500 ml-auto">{new Date(m.startedAt).toLocaleTimeString()}</span>
              </div>
              <div className="font-mono text-[12px] text-zinc-200">{m.goal}</div>
              {m.result?.taskResults && (
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-1">
                  {m.result.taskResults.map((tr: any, i: number) => (
                    <div key={i} className="border border-zinc-700/50 rounded p-1.5 bg-black/20">
                      <div className="font-mono text-[8px] text-zinc-500 uppercase">{tr.agent}</div>
                      <div className={cn("font-mono text-[9px]", tr.status === "DONE" ? "text-emerald-400" : tr.status === "FAILED" ? "text-rose-400" : "text-amber-400")}>{tr.status}</div>
                    </div>
                  ))}
                </div>
              )}
              {m.error && <div className="mt-1 text-[10px] font-mono text-rose-400">Error: {m.error}</div>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ============== Agents View ==============
function AgentsView() {
  const [agents, setAgents] = useState<any[]>([]);
  const [states, setStates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [aRes, sRes] = await Promise.all([
        fetch("/api/genesis/agents"),
        fetch("/api/genesis/agents/states"),
      ]);
      if (aRes.ok) setAgents((await aRes.json()).agents ?? []);
      if (sRes.ok) setStates((await sRes.json()).agents ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  const togglePause = async (agent: string, currentlyPaused: boolean) => {
    await fetch("/api/genesis/agents/states", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent, action: currentlyPaused ? "resume" : "pause" }),
    });
    load();
  };

  if (loading) return <div className="text-[11px] font-mono text-zinc-500 py-8 text-center">Loading agents…</div>;

  return (
    <div className="space-y-3">
      <div className="section-h">▸ AGENTS ({agents.length})</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {agents.map((a) => {
          const state = states.find((s: any) => s.agent === a.name);
          const paused = state?.paused ?? false;
          const st = state?.state ?? "IDLE";
          return (
            <div key={a.name} className="genesis-panel p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className={cn("w-2 h-2 rounded-full", paused ? "bg-zinc-500" : st === "EXECUTING" ? "bg-emerald-400 flicker" : st === "THINKING" ? "bg-amber-400" : "bg-cyan-400")} />
                <span className="font-mono text-[12px] font-bold text-zinc-100">{a.name}</span>
                <span className="font-mono text-[8px] text-zinc-500 uppercase ml-auto">{a.department}</span>
              </div>
              <div className="font-mono text-[10px] text-zinc-400 mb-2">{a.description}</div>
              <div className="flex items-center gap-2 text-[9px] font-mono">
                <span className={cn("px-1.5 py-0.5 rounded uppercase", paused ? "bg-zinc-700/50 text-zinc-400" : st === "EXECUTING" ? "bg-emerald-500/20 text-emerald-400" : "bg-cyan-500/20 text-cyan-400")}>{paused ? "PAUSED" : st}</span>
                {state?.currentExecutionId && <span className="text-zinc-500">{state.currentExecutionId}</span>}
                <button
                  onClick={() => togglePause(a.name, paused)}
                  className={cn("ml-auto px-2 py-0.5 rounded border text-[9px]", paused ? "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10" : "border-amber-500/30 text-amber-400 hover:bg-amber-500/10")}
                >
                  {paused ? "RESUME" : "PAUSE"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============== Tasks View ==============
function TasksView({ summary }: { summary: any }) {
  const tasks = summary?.tasks ?? [];
  const [filter, setFilter] = useState<string>("ALL");
  const filtered = filter === "ALL" ? tasks : tasks.filter((t: any) => t.status === filter);
  const statusCounts = (summary?.statusCounts ?? {});

  return (
    <div className="space-y-3">
      <div className="section-h">▸ TASK GRAPH ({tasks.length})</div>
      <div className="flex flex-wrap gap-1">
        {["ALL", "PENDING", "IN_PROGRESS", "DONE", "FAILED", "BLOCKED"].map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={cn("px-2 py-1 rounded text-[9px] font-mono uppercase border", filter === s ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-zinc-700/50 text-zinc-500 hover:bg-zinc-800/30")}>
            {s} ({s === "ALL" ? tasks.length : (statusCounts[s] ?? 0)})
          </button>
        ))}
      </div>
      <div className="space-y-1 max-h-[600px] overflow-y-auto">
        {filtered.map((t: any) => (
          <div key={t.taskId} className="genesis-panel p-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-emerald-400">{t.taskId}</span>
              <span className={cn("font-mono text-[8px] uppercase px-1.5 py-0.5 rounded",
                t.status === "DONE" ? "bg-emerald-500/20 text-emerald-400" :
                t.status === "IN_PROGRESS" ? "bg-amber-500/20 text-amber-400" :
                t.status === "FAILED" ? "bg-rose-500/20 text-rose-400" :
                t.status === "BLOCKED" ? "bg-zinc-700/50 text-zinc-400" :
                "bg-cyan-500/20 text-cyan-400"
              )}>{t.status.replace("_", " ")}</span>
              <span className="font-mono text-[8px] text-violet-400 uppercase">{t.ownerAgent}</span>
              <span className="font-mono text-[9px] text-zinc-300 truncate flex-1">{t.title}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============== Memory View ==============
function MemoryView() {
  const [memory, setMemory] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/genesis/memory?q=${encodeURIComponent(q)}&limit=50`);
      if (res.ok) setMemory((await res.json()).memory ?? []);
    } finally { setLoading(false); }
  }, [q]);

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  return (
    <div className="space-y-3">
      <div className="section-h">▸ MEMORY BANK ({memory.length})</div>
      <input className="input-genesis w-full" placeholder="Search memories…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") load(); }} />
      <div className="space-y-1 max-h-[600px] overflow-y-auto">
        {memory.length === 0 ? (
          <div className="text-[11px] font-mono text-zinc-500 py-8 text-center">{loading ? "Loading…" : "No memories. Run agents to populate."}</div>
        ) : (
          memory.map((m: any) => (
            <div key={m.id} className="genesis-panel p-2">
              <div className="flex items-center gap-2 mb-1">
                <span className={cn("font-mono text-[8px] uppercase px-1.5 py-0.5 rounded",
                  m.type === "EPISODIC" ? "bg-cyan-500/20 text-cyan-400" :
                  m.type === "SEMANTIC" ? "bg-emerald-500/20 text-emerald-400" :
                  "bg-violet-500/20 text-violet-400"
                )}>{m.type}</span>
                <span className="font-mono text-[10px] text-zinc-300 flex-1 truncate">{m.title}</span>
                <span className="font-mono text-[8px] text-zinc-500">★{m.importance}</span>
                {m.score !== undefined && <span className="font-mono text-[8px] text-emerald-400">score={m.score.toFixed(1)}</span>}
              </div>
              <div className="font-mono text-[9px] text-zinc-500 truncate">{m.content?.slice(0, 120)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ============== Messages View ==============
function MessagesView() {
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/genesis/messages");
      if (res.ok) setMessages((await res.json()).messages ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);

  return (
    <div className="space-y-3">
      <div className="section-h">▸ AGENT MESSAGES ({messages.length})</div>
      <div className="space-y-1 max-h-[600px] overflow-y-auto">
        {messages.length === 0 ? (
          <div className="text-[11px] font-mono text-zinc-500 py-8 text-center">{loading ? "Loading…" : "No messages. Agents communicate via the collaboration graph."}</div>
        ) : (
          messages.map((m: any) => (
            <div key={m.messageId} className="genesis-panel p-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] text-cyan-400">{m.fromAgent}</span>
                <span className="font-mono text-[9px] text-zinc-500">→</span>
                <span className="font-mono text-[9px] text-violet-400">{m.toAgent}</span>
                <span className="font-mono text-[8px] uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">{m.type}</span>
                <span className="font-mono text-[8px] text-zinc-600 ml-auto">{new Date(m.createdAt).toLocaleTimeString()}</span>
              </div>
              <div className="font-mono text-[10px] text-zinc-400 mt-1 truncate">{JSON.stringify(m.payload).slice(0, 150)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ============== Security View ==============
function SecurityView() {
  const [findings, setFindings] = useState<any[]>([]);
  const [releaseCheck, setReleaseCheck] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [fRes, rRes] = await Promise.all([
        fetch("/api/genesis/security?limit=50"),
        fetch("/api/genesis/security/release-check"),
      ]);
      if (fRes.ok) setFindings((await fRes.json()).findings ?? []);
      if (rRes.ok) setReleaseCheck(await rRes.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const resolve = async (id: string, action: string) => {
    await fetch(`/api/genesis/security/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    load();
  };

  return (
    <div className="space-y-3">
      <div className="section-h">▸ SECURITY FINDINGS ({findings.length})</div>
      {releaseCheck && (
        <div className={cn("genesis-panel p-3 border", releaseCheck.blocked ? "border-rose-500/40 bg-rose-500/5" : "border-emerald-500/40 bg-emerald-500/5")}>
          <div className="font-mono text-[12px] font-bold">
            {releaseCheck.blocked ? "🚫 RELEASE BLOCKED" : "✅ RELEASE ALLOWED"}
          </div>
          <div className="font-mono text-[10px] text-zinc-400 mt-1">
            {releaseCheck.blockers?.length ?? 0} blockers · {releaseCheck.totalOpen ?? 0} total open findings
          </div>
        </div>
      )}
      <div className="space-y-1 max-h-[600px] overflow-y-auto">
        {findings.length === 0 ? (
          <div className="text-[11px] font-mono text-zinc-500 py-8 text-center">{loading ? "Loading…" : "No security findings. Run the SECURITY agent to scan."}</div>
        ) : (
          findings.map((f: any) => (
            <div key={f.id} className="genesis-panel p-2">
              <div className="flex items-center gap-2">
                <span className={cn("font-mono text-[8px] uppercase px-1.5 py-0.5 rounded",
                  f.severity === "CRITICAL" ? "bg-rose-500/30 text-rose-300" :
                  f.severity === "HIGH" ? "bg-rose-500/20 text-rose-400" :
                  f.severity === "MEDIUM" ? "bg-amber-500/20 text-amber-400" :
                  "bg-zinc-700/50 text-zinc-400"
                )}>{f.severity}</span>
                <span className="font-mono text-[9px] text-zinc-500 uppercase">{f.rule}</span>
                <span className="font-mono text-[10px] text-zinc-300 flex-1 truncate">{f.message}</span>
                {f.file && <span className="font-mono text-[8px] text-zinc-600">{f.file}{f.line ? `:${f.line}` : ""}</span>}
              </div>
              {f.status === "OPEN" && (
                <div className="flex gap-1 mt-1">
                  <button onClick={() => resolve(f.id, "fix")} className="px-2 py-0.5 rounded border border-emerald-500/30 text-[9px] text-emerald-400 hover:bg-emerald-500/10">FIX</button>
                  <button onClick={() => resolve(f.id, "acknowledge")} className="px-2 py-0.5 rounded border border-amber-500/30 text-[9px] text-amber-400 hover:bg-amber-500/10">ACK</button>
                  <button onClick={() => resolve(f.id, "false-positive")} className="px-2 py-0.5 rounded border border-zinc-700/50 text-[9px] text-zinc-400 hover:bg-zinc-800/30">FALSE POS</button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ============== Observability View ==============
function ObservabilityView() {
  const [summary, setSummary] = useState<any>(null);
  const [cost, setCost] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [sRes, cRes] = await Promise.all([
        fetch("/api/genesis/metrics/summary?windowHours=24"),
        fetch("/api/genesis/metrics/cost?days=7"),
      ]);
      if (sRes.ok) setSummary(await sRes.json());
      if (cRes.ok) setCost(await cRes.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  if (loading) return <div className="text-[11px] font-mono text-zinc-500 py-8 text-center">Loading metrics…</div>;

  return (
    <div className="space-y-3">
      <div className="section-h">▸ OBSERVABILITY</div>

      {/* Totals */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <KpiStat label="Executions (24h)" value={summary?.totals?.executions ?? 0} icon={<ActivityIcon className="w-3 h-3" />} accent="cyan" />
        <KpiStat label="Tool Calls" value={summary?.totals?.toolCalls ?? 0} icon={<Terminal className="w-3 h-3" />} accent="emerald" />
        <KpiStat label="Artifacts" value={summary?.totals?.artifacts ?? 0} icon={<Boxes className="w-3 h-3" />} accent="violet" />
        <KpiStat label="Success Rate" value={`${Math.round((summary?.totals?.successRate ?? 0) * 100)}%`} icon={<CheckCircle2 className="w-3 h-3" />} accent="emerald" />
      </div>

      {/* Agent Performance Table */}
      <div className="genesis-panel p-3">
        <div className="section-h">▸ AGENT PERFORMANCE (24h)</div>
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-[10px] font-mono">
            <thead>
              <tr className="text-zinc-500 uppercase text-[8px] border-b border-zinc-800">
                <th className="text-left py-1">Agent</th>
                <th className="text-right">Execs</th>
                <th className="text-right">Success</th>
                <th className="text-right">Avg ms</th>
                <th className="text-right">P95 ms</th>
                <th className="text-right">Tools</th>
                <th className="text-right">Errors</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.agents ?? []).map((a: any) => (
                <tr key={a.agent} className="border-b border-zinc-900">
                  <td className="py-1 text-emerald-400">{a.agent}</td>
                  <td className="text-right text-zinc-300">{a.totalExecutions}</td>
                  <td className="text-right text-zinc-300">{Math.round(a.successRate * 100)}%</td>
                  <td className="text-right text-zinc-400">{a.avgDurationMs}</td>
                  <td className="text-right text-zinc-400">{a.p95DurationMs}</td>
                  <td className="text-right text-zinc-400">{a.toolCallCount}</td>
                  <td className="text-right text-rose-400">{a.errorCount}</td>
                </tr>
              ))}
              {(summary?.agents ?? []).length === 0 && (
                <tr><td colSpan={7} className="text-center text-zinc-500 py-4">No agent executions yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cost */}
      <div className="genesis-panel p-3">
        <div className="section-h">▸ COST (7 days)</div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div>
            <div className="font-mono text-[9px] text-zinc-500 uppercase">Total Tokens</div>
            <div className="font-mono text-[16px] text-emerald-400">{(cost?.totalTokens ?? 0).toLocaleString()}</div>
          </div>
          <div>
            <div className="font-mono text-[9px] text-zinc-500 uppercase">Estimated Cost</div>
            <div className="font-mono text-[16px] text-amber-400">${(cost?.totalCost ?? 0).toFixed(4)}</div>
          </div>
        </div>
      </div>

      {/* Recent Errors */}
      {summary?.recentErrors?.length > 0 && (
        <div className="genesis-panel p-3">
          <div className="section-h">▸ RECENT ERRORS</div>
          <div className="space-y-1 mt-2">
            {summary.recentErrors.slice(0, 10).map((e: any) => (
              <div key={e.executionId} className="font-mono text-[10px] text-rose-400">
                <span className="text-zinc-500">{e.executionId}</span> {e.agent}: {e.error?.slice(0, 100)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============== Sandboxes View ==============
function SandboxesView() {
  const [sandboxes, setSandboxes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/genesis/sandboxes");
      if (res.ok) setSandboxes((await res.json()).sandboxes ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const cleanup = async (id: string) => {
    await fetch(`/api/genesis/sandboxes/${id}`, { method: "DELETE" });
    load();
  };

  const cleanupExpired = async () => {
    await fetch("/api/genesis/sandboxes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cleanup-expired" }) });
    load();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="section-h">▸ SANDBOXES ({sandboxes.length})</div>
        <button onClick={cleanupExpired} className="ml-auto px-2 py-1 rounded border border-amber-500/30 text-[9px] font-mono text-amber-400 hover:bg-amber-500/10">CLEAN EXPIRED</button>
      </div>
      <div className="space-y-1 max-h-[600px] overflow-y-auto">
        {sandboxes.length === 0 ? (
          <div className="text-[11px] font-mono text-zinc-500 py-8 text-center">{loading ? "Loading…" : "No active sandboxes."}</div>
        ) : (
          sandboxes.map((s: any) => (
            <div key={s.sandboxId} className="genesis-panel p-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-emerald-400">{s.sandboxId}</span>
                <span className={cn("font-mono text-[8px] uppercase px-1.5 py-0.5 rounded",
                  s.healthCheck === "HEALTHY" ? "bg-emerald-500/20 text-emerald-400" :
                  s.healthCheck === "UNHEALTHY" ? "bg-rose-500/20 text-rose-400" :
                  "bg-zinc-700/50 text-zinc-400"
                )}>{s.healthCheck}</span>
                {s.port && <span className="font-mono text-[9px] text-cyan-400">:{s.port}</span>}
                {s.pid && <span className="font-mono text-[9px] text-zinc-500">pid={s.pid}</span>}
                <span className="font-mono text-[8px] text-zinc-600 ml-auto">{new Date(s.createdAt).toLocaleString()}</span>
                <button onClick={() => cleanup(s.sandboxId)} className="px-1.5 py-0.5 rounded border border-rose-500/30 text-[9px] font-mono text-rose-400 hover:bg-rose-500/10">CLEAN</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ============== Genesis State View ==============
function GenesisStateView({ summary }: { summary: any }) {
  const state = summary?.state ?? {};
  const decisions = summary?.decisions ?? [];
  const checkpoints = summary?.checkpoints ?? [];

  return (
    <div className="space-y-3">
      <div className="genesis-panel p-3">
        <div className="section-h">▸ MISSION</div>
        <div className="font-mono text-[11px] text-zinc-300 mt-1">{state.mission ?? "—"}</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="genesis-panel p-3">
          <div className="section-h">▸ CEO DECISIONS ({decisions.length})</div>
          <div className="space-y-1 mt-2 max-h-[300px] overflow-y-auto">
            {decisions.map((d: any) => (
              <div key={d.id} className="border border-zinc-800 rounded p-2 bg-black/20">
                <div className="font-mono text-[10px] text-emerald-400">{d.title}</div>
                <div className="font-mono text-[9px] text-zinc-500 mt-1">{d.decision}</div>
              </div>
            ))}
            {decisions.length === 0 && <div className="text-[10px] font-mono text-zinc-500 py-2 text-center">No decisions yet.</div>}
          </div>
        </div>

        <div className="genesis-panel p-3">
          <div className="section-h">▸ BUILD CHECKPOINTS ({checkpoints.length})</div>
          <div className="space-y-1 mt-2 max-h-[300px] overflow-y-auto">
            {checkpoints.map((c: any) => (
              <div key={c.id} className="border border-zinc-800 rounded p-2 bg-black/20">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[9px] text-emerald-400">{c.version}</span>
                  <span className={cn("font-mono text-[8px] uppercase px-1 rounded", c.status === "PASSED" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400")}>{c.status}</span>
                  <span className="font-mono text-[8px] text-zinc-500 ml-auto">{c.testsPassed}/{c.testsPassed + c.testsFailed} tests</span>
                </div>
                <div className="font-mono text-[9px] text-zinc-500 mt-1 truncate">{c.summary}</div>
              </div>
            ))}
            {checkpoints.length === 0 && <div className="text-[10px] font-mono text-zinc-500 py-2 text-center">No checkpoints yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============== KPI Stat ==============
function KpiStat({ label, value, icon, accent }: { label: string; value: number | string; icon: React.ReactNode; accent: "emerald" | "cyan" | "amber" | "violet" | "rose"; }) {
  const colors: Record<string, string> = {
    emerald: "text-emerald-400 border-emerald-500/20",
    cyan: "text-cyan-400 border-cyan-500/20",
    amber: "text-amber-400 border-amber-500/20",
    violet: "text-violet-400 border-violet-500/20",
    rose: "text-rose-400 border-rose-500/20",
  };
  return (
    <div className={cn("genesis-panel p-2 border", colors[accent])}>
      <div className="flex items-center gap-1">
        <span className={colors[accent].split(" ")[0]}>{icon}</span>
        <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-wider">{label}</span>
      </div>
      <div className={cn("font-mono text-[18px] font-bold mt-1", colors[accent].split(" ")[0])}>{value}</div>
    </div>
  );
}
