"use client";

import {
  Activity,
  Boxes,
  BrainCircuit,
  CheckCircle2,
  Crown,
  Cpu,
  DollarSign,
  DraftingCompass,
  Gauge,
  Palette,
  Radar,
  ShieldCheck,
  Target,
  Telescope,
  Terminal,
  Timer,
  TrendingUp,
  Zap,
} from "lucide-react";
import { GenesisSummary, DEPARTMENT_META } from "@/lib/genesis/types";
import { ActivityFeed } from "../activity-feed";
import { Chip, GenesisProgress, HudPanel, KpiStat, timeAgo } from "../primitives";
import { cn } from "@/lib/utils";
import { useMemo } from "react";

export function CommandCenter({
  summary,
  onRefresh,
}: {
  summary: GenesisSummary;
  onRefresh: () => void;
}) {
  const { state, departments, metrics, tasks, loops, recentActivity, statusCounts } = summary;

  const metricMap = useMemo(() => {
    const m: Record<string, number> = {};
    metrics.forEach((x) => (m[x.name] = x.value));
    return m;
  }, [metrics]);

  const totalTasks = tasks.length;
  const doneTasks = statusCounts.DONE ?? 0;
  const inProgress = statusCounts.IN_PROGRESS ?? 0;
  const blocked = statusCounts.BLOCKED ?? 0;
  const pending = statusCounts.PENDING ?? 0;
  const completionPct = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;

  const runningLoops = loops.filter((l) => l.status === "RUNNING").length;
  const pausedLoops = loops.filter((l) => l.status === "PAUSED").length;

  // synthetic 12-point trend for tokens/cost (deterministic from cycle)
  const trend = useMemo(() => {
    const base = metricMap.tokens_today ?? 4000000;
    return Array.from({ length: 12 }, (_, i) => ({
      t: `T-${11 - i}`,
      tokens: Math.round(base * (0.7 + 0.3 * (i / 11)) + (i % 3) * 90000),
      cost: Number((Number(state.model_cost_today ?? 12) * (0.6 + 0.4 * (i / 11))).toFixed(2)),
    }));
  }, [metricMap, state]);

  const maxTokens = Math.max(...trend.map((t) => t.tokens));

  return (
    <div className="space-y-4">
      {/* Mission banner */}
      <HudPanel
        title="Active Mission"
        subtitle={`boot ${timeAgo(state.boot_epoch)} · vision source: ${state.vision_source}`}
        icon={<Target className="w-3.5 h-3.5" />}
        accent="emerald"
        right={
          <div className="flex items-center gap-2">
            <Chip variant="emerald" dot>EXECUTING</Chip>
            <button
              onClick={onRefresh}
              className="font-mono text-[9px] uppercase tracking-wider px-2 py-1 rounded border border-emerald-500/30 text-emerald-400/80 hover:bg-emerald-500/10 hover:text-emerald-400"
            >
              sync
            </button>
          </div>
        }
      >
        <p className="font-mono text-[13px] leading-relaxed text-zinc-300 max-w-4xl">
          {state.mission}
        </p>
        <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-emerald-500/10">
          <Chip variant="cyan">PHASE · {state.phase}</Chip>
          <Chip variant="amber">CYCLE {state.cycle}</Chip>
          <Chip variant="emerald">{state.products_shipped} PRODUCT SHIPPED</Chip>
          <span className="ml-auto font-mono text-[10px] text-zinc-500">
            completion · {completionPct}% · {doneTasks}/{totalTasks} tasks
          </span>
        </div>
      </HudPanel>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard icon={<BrainCircuit className="w-3 h-3" />} label="Active Agents" value={state.active_agents} accent="emerald" sub={`${runningLoops} loops running`} />
        <KpiCard icon={<CheckCircle2 className="w-3 h-3" />} label="Tasks Done 24h" value={metricMap.tasks_completed_24h ?? 0} accent="cyan" sub={`${inProgress} in progress`} />
        <KpiCard icon={<Gauge className="w-3 h-3" />} label="Build Pass" value={`${Math.round((metricMap.build_pass_rate ?? 0) * 100)}%`} accent="emerald" sub={`target ${Math.round((metrics.find((m) => m.name === "build_pass_rate")?.target ?? 0) * 100)}%`} />
        <KpiCard icon={<DollarSign className="w-3 h-3" />} label="Model Cost" value={`$${state.model_cost_today}`} accent="amber" sub={`target $${metrics.find((m) => m.name === "model_cost_today_usd")?.target ?? 15}`} />
        <KpiCard icon={<Timer className="w-3 h-3" />} label="p99 Latency" value={`${metricMap.p99_api_latency_ms ?? 0}`} unit="ms" accent="cyan" sub={`target ${metrics.find((m) => m.name === "p99_api_latency_ms")?.target ?? 200}ms`} />
        <KpiCard icon={<ShieldCheck className="w-3 h-3" />} label="Coverage" value={`${Math.round((metricMap.test_coverage ?? 0) * 100)}%`} accent="violet" sub={`${blocked} blocked tasks`} />
      </div>

      {/* Main grid: departments + task breakdown + activity feed */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Departments grid — spans 2 */}
        <HudPanel
          title="Department Grid"
          subtitle="8 autonomous departments · live health"
          icon={<Cpu className="w-3.5 h-3.5" />}
          accent="emerald"
          className="xl:col-span-2"
          bodyClassName="p-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {departments.map((d) => {
              const meta = DEPARTMENT_META[d.key];
              const accent = meta?.accent ?? "emerald";
              return (
                <div
                  key={d.key}
                  className="group rounded-md border border-emerald-500/10 bg-black/30 p-3 hover:border-emerald-500/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={cn(
                          "w-6 h-6 rounded-sm border flex items-center justify-center shrink-0",
                          accent === "emerald" && "border-emerald-500/40 text-emerald-400 bg-emerald-500/5",
                          accent === "cyan" && "border-cyan-500/40 text-cyan-400 bg-cyan-500/5",
                          accent === "amber" && "border-amber-500/40 text-amber-400 bg-amber-500/5",
                          accent === "rose" && "border-rose-500/40 text-rose-400 bg-rose-500/5",
                          accent === "violet" && "border-violet-500/40 text-violet-400 bg-violet-500/5"
                        )}
                      >
                        <DeptIcon k={d.key} />
                      </span>
                      <div className="min-w-0">
                        <div className="font-mono text-[11px] tracking-wide text-zinc-200 truncate">
                          {d.name}
                        </div>
                        <div className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider">
                          {d.activeAgents} agents · {d.completedTasks} done
                        </div>
                      </div>
                    </div>
                    <Chip variant={d.status === "ACTIVE" ? "emerald" : d.status === "IDLE" ? "zinc" : "rose"} dot>
                      {d.status}
                    </Chip>
                  </div>
                  <div className="mt-2.5 grid grid-cols-2 gap-2 text-[10px] font-mono">
                    <div>
                      <div className="flex justify-between text-zinc-500 mb-0.5">
                        <span>HEALTH</span>
                        <span className={cn(accent === "rose" ? "text-rose-400" : accent === "amber" ? "text-amber-400" : "text-emerald-400")}>{d.health}%</span>
                      </div>
                      <GenesisProgress value={d.health} accent={accent} />
                    </div>
                    <div>
                      <div className="flex justify-between text-zinc-500 mb-0.5">
                        <span>LOAD</span>
                        <span className="text-cyan-400">{d.load}%</span>
                      </div>
                      <GenesisProgress value={d.load} accent="cyan" showShimmer={d.load > 60} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </HudPanel>

        {/* Live activity feed */}
        <HudPanel
          title="Live Activity Feed"
          subtitle="real-time agent telemetry"
          icon={<Activity className="w-3.5 h-3.5" />}
          accent="cyan"
          bodyClassName="p-3"
        >
          <ActivityFeed initial={recentActivity} maxHeight="max-h-[460px]" />
        </HudPanel>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Task status breakdown */}
        <HudPanel
          title="Task Status Distribution"
          subtitle={`${totalTasks} tasks across 8 departments`}
          icon={<Boxes className="w-3.5 h-3.5" />}
          accent="emerald"
        >
          <div className="space-y-2.5">
            <StatusBar label="DONE" count={doneTasks} total={totalTasks} accent="emerald" />
            <StatusBar label="IN_PROGRESS" count={inProgress} total={totalTasks} accent="cyan" />
            <StatusBar label="REVIEW" count={statusCounts.REVIEW ?? 0} total={totalTasks} accent="amber" />
            <StatusBar label="BLOCKED" count={blocked} total={totalTasks} accent="rose" />
            <StatusBar label="PENDING" count={pending} total={totalTasks} accent="zinc" />
          </div>
        </HudPanel>

        {/* Throughput trend (synthetic) */}
        <HudPanel
          title="Throughput Trend"
          subtitle="tokens processed · last 12 cycles"
          icon={<TrendingUp className="w-3.5 h-3.5" />}
          accent="cyan"
        >
          <div className="flex items-end gap-1 h-40 pt-2">
            {trend.map((t, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
                <div className="w-full flex-1 flex items-end">
                  <div
                    className="w-full rounded-t-sm bg-gradient-to-t from-emerald-500/30 to-emerald-400 group-hover:to-emerald-300 transition-colors"
                    style={{ height: `${(t.tokens / maxTokens) * 100}%`, minHeight: 4 }}
                    title={`${t.tokens.toLocaleString()} tokens`}
                  />
                </div>
                <span className="font-mono text-[8px] text-zinc-600">{t.t}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-emerald-500/10">
            <span className="font-mono text-[10px] text-zinc-500">peak</span>
            <span className="font-mono text-[10px] text-emerald-400">{maxTokens.toLocaleString()} tok</span>
          </div>
        </HudPanel>

        {/* Loop health */}
        <HudPanel
          title="Operational Loop Health"
          subtitle={`${runningLoops} running · ${pausedLoops} paused`}
          icon={<Zap className="w-3.5 h-3.5" />}
          accent="amber"
        >
          <div className="space-y-2">
            {loops.slice(0, 6).map((l) => (
              <div key={l.key} className="flex items-center gap-2">
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    l.status === "RUNNING" ? "bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.8)]" : "bg-amber-400"
                  )}
                />
                <span className="font-mono text-[10px] text-zinc-300 truncate flex-1">{l.name}</span>
                <span className="font-mono text-[10px] text-zinc-500">{l.cycleCount}</span>
                <span className="font-mono text-[10px] text-emerald-400 w-8 text-right">{l.healthScore}%</span>
              </div>
            ))}
          </div>
        </HudPanel>
      </div>

      {/* Next actions */}
      <HudPanel
        title="Next Actions · CEO Priority Queue"
        subtitle="highest value tasks first"
        icon={<Radar className="w-3.5 h-3.5" />}
        accent="violet"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {(() => {
            try {
              return JSON.parse(state.next_actions) as string[];
            } catch {
              return [];
            }
          })().map((action, i) => (
            <div
              key={i}
              className="flex items-start gap-2.5 rounded border border-violet-500/15 bg-violet-500/5 px-3 py-2"
            >
              <span className="font-mono text-[10px] text-violet-400 mt-0.5">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="font-mono text-[11px] text-zinc-300 leading-relaxed">{action}</span>
            </div>
          ))}
        </div>
      </HudPanel>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  unit,
  accent,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  unit?: string;
  accent: "emerald" | "cyan" | "amber" | "rose" | "violet";
  sub?: string;
}) {
  return (
    <div className="genesis-panel genesis-panel-hover rounded-md p-3 hud-corners">
      <KpiStat label={label} value={value} unit={unit} accent={accent} sub={sub} icon={icon} />
    </div>
  );
}

function StatusBar({
  label,
  count,
  total,
  accent,
}: {
  label: string;
  count: number;
  total: number;
  accent: "emerald" | "cyan" | "amber" | "rose" | "zinc";
}) {
  const pct = total ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1 font-mono text-[10px]">
        <span className="text-zinc-400 tracking-wide">{label}</span>
        <span className="text-zinc-300">
          {count} <span className="text-zinc-600">/ {total}</span>
          <span className="text-zinc-600 ml-1.5">({pct}%)</span>
        </span>
      </div>
      <GenesisProgress value={pct} accent={accent === "zinc" ? "emerald" : accent} />
    </div>
  );
}

function DeptIcon({ k }: { k: string }) {
  const map: Record<string, React.ReactNode> = {
    ceo: <Crown className="w-3.5 h-3.5" />,
    research: <Telescope className="w-3.5 h-3.5" />,
    product: <DraftingCompass className="w-3.5 h-3.5" />,
    engineering: <Terminal className="w-3.5 h-3.5" />,
    ai_systems: <BrainCircuit className="w-3.5 h-3.5" />,
    design: <Palette className="w-3.5 h-3.5" />,
    growth: <TrendingUp className="w-3.5 h-3.5" />,
    quality: <ShieldCheck className="w-3.5 h-3.5" />,
  };
  return <>{map[k] ?? <Boxes className="w-3.5 h-3.5" />}</>;
}
