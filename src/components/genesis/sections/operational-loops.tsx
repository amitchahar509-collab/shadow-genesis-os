"use client";

import { useState } from "react";
import {
  Activity,
  GitBranch,
  Pause,
  Play,
  Radar,
  Repeat,
  RotateCw,
  ShieldCheck,
  Sparkles,
  Timer,
  Workflow,
  Zap,
} from "lucide-react";
import { OperationalLoop } from "@/lib/genesis/types";
import { Chip, GenesisProgress, HudPanel, timeAgo } from "../primitives";
import { cn } from "@/lib/utils";

const LOOP_ICONS: Record<string, React.ReactNode> = {
  self_correction: <RotateCw className="w-4 h-4" />,
  sandbox: <Workflow className="w-4 h-4" />,
  git: <GitBranch className="w-4 h-4" />,
  security: <ShieldCheck className="w-4 h-4" />,
  model_orchestration: <Sparkles className="w-4 h-4" />,
  deployment: <Repeat className="w-4 h-4" />,
  feedback: <Activity className="w-4 h-4" />,
  learning: <Zap className="w-4 h-4" />,
};

const ACCENT: Record<string, "emerald" | "cyan" | "amber" | "rose" | "violet"> = {
  self_correction: "emerald",
  sandbox: "cyan",
  git: "cyan",
  security: "amber",
  model_orchestration: "violet",
  deployment: "rose",
  feedback: "emerald",
  learning: "violet",
};

export function OperationalLoops({ loops }: { loops: OperationalLoop[] }) {
  const [localLoops, setLocalLoops] = useState(loops);
  const [toggling, setToggling] = useState<string | null>(null);

  async function toggle(loop: OperationalLoop) {
    const next = loop.status === "RUNNING" ? "PAUSED" : "RUNNING";
    setToggling(loop.id);
    // optimistic
    setLocalLoops((prev) =>
      prev.map((l) =>
        l.id === loop.id
          ? { ...l, status: next, lastRunAt: next === "RUNNING" ? new Date().toISOString() : l.lastRunAt }
          : l
      )
    );
    try {
      await fetch("/api/genesis/loops", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: loop.id, status: next }),
      });
    } catch {
      // revert on failure
      setLocalLoops((prev) => prev.map((l) => (l.id === loop.id ? loop : l)));
    } finally {
      setToggling(null);
    }
  }

  const running = localLoops.filter((l) => l.status === "RUNNING").length;
  const paused = localLoops.filter((l) => l.status === "PAUSED").length;
  const avgHealth = Math.round(
    localLoops.reduce((s, l) => s + l.healthScore, 0) / localLoops.length
  );

  return (
    <div className="space-y-4">
      <HudPanel
        title="Operational Loop Engine"
        subtitle="continuous autonomous execution · never stop at ideas"
        icon={<Repeat className="w-3.5 h-3.5" />}
        accent="emerald"
        right={
          <div className="flex items-center gap-2">
            <Chip variant="emerald" dot>{running} RUNNING</Chip>
            {paused > 0 && <Chip variant="amber">{paused} PAUSED</Chip>}
          </div>
        }
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <LoopStat label="Total Loops" value={String(localLoops.length)} accent="emerald" />
          <LoopStat label="Running" value={String(running)} accent="cyan" />
          <LoopStat label="Paused" value={String(paused)} accent="amber" />
          <LoopStat label="Avg Health" value={`${avgHealth}%`} accent="violet" />
        </div>
      </HudPanel>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {localLoops.map((loop) => {
          const accent = ACCENT[loop.key] ?? "emerald";
          const isRunning = loop.status === "RUNNING";
          return (
            <div
              key={loop.id}
              className="genesis-panel genesis-panel-hover rounded-md p-4 hud-corners"
            >
              <div className="flex items-start gap-3 mb-3">
                <span
                  className={cn(
                    "w-10 h-10 rounded-sm border flex items-center justify-center shrink-0",
                    accent === "emerald" && "border-emerald-500/40 text-emerald-400 bg-emerald-500/5",
                    accent === "cyan" && "border-cyan-500/40 text-cyan-400 bg-cyan-500/5",
                    accent === "amber" && "border-amber-500/40 text-amber-400 bg-amber-500/5",
                    accent === "rose" && "border-rose-500/40 text-rose-400 bg-rose-500/5",
                    accent === "violet" && "border-violet-500/40 text-violet-400 bg-violet-500/5"
                  )}
                >
                  {LOOP_ICONS[loop.key] ?? <Repeat className="w-4 h-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-mono text-[13px] text-zinc-100 tracking-wide">{loop.name}</h3>
                    <Chip
                      variant={isRunning ? "emerald" : loop.status === "PAUSED" ? "amber" : "rose"}
                      dot={isRunning}
                    >
                      {loop.status}
                    </Chip>
                  </div>
                  <p className="font-mono text-[10px] text-zinc-500 mt-0.5">{loop.interval} interval</p>
                </div>
                <button
                  onClick={() => toggle(loop)}
                  disabled={toggling === loop.id}
                  className={cn(
                    "shrink-0 font-mono text-[9px] uppercase tracking-wider px-2.5 py-1.5 rounded border flex items-center gap-1 transition-colors disabled:opacity-50",
                    isRunning
                      ? "border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                      : "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                  )}
                >
                  {isRunning ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                  {isRunning ? "PAUSE" : "RESUME"}
                </button>
              </div>

              <p className="font-mono text-[11px] text-zinc-400 leading-relaxed mb-3">
                {loop.description}
              </p>

              <div className="grid grid-cols-3 gap-2 mb-3">
                <Metric label="cycles" value={loop.cycleCount.toLocaleString()} />
                <Metric label="last run" value={timeAgo(loop.lastRunAt)} icon={<Timer className="w-2.5 h-2.5" />} />
                <Metric label="health" value={`${loop.healthScore}%`} />
              </div>

              <div className="mb-2">
                <div className="flex justify-between font-mono text-[10px] mb-1">
                  <span className="text-zinc-500">HEALTH SCORE</span>
                  <span
                    className={cn(
                      loop.healthScore >= 90
                        ? "text-emerald-400"
                        : loop.healthScore >= 75
                        ? "text-amber-400"
                        : "text-rose-400"
                    )}
                  >
                    {loop.healthScore}%
                  </span>
                </div>
                <GenesisProgress
                  value={loop.healthScore}
                  accent={loop.healthScore >= 90 ? "emerald" : loop.healthScore >= 75 ? "amber" : "rose"}
                  showShimmer={isRunning && loop.healthScore < 100}
                />
              </div>

              {loop.detail && (
                <div className="mt-2 flex items-start gap-1.5 rounded border border-emerald-500/10 bg-black/30 px-2 py-1.5">
                  <Radar className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" />
                  <span className="font-mono text-[10px] text-zinc-400 leading-relaxed">
                    {loop.detail}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LoopStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: "emerald" | "cyan" | "amber" | "violet";
}) {
  const text: Record<string, string> = {
    emerald: "text-emerald-400",
    cyan: "text-cyan-400",
    amber: "text-amber-400",
    violet: "text-violet-400",
  };
  return (
    <div className="rounded border border-emerald-500/10 bg-black/20 px-3 py-2">
      <div className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider">{label}</div>
      <div className={cn("font-mono text-xl font-semibold tabular-nums", text[accent])}>{value}</div>
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded border border-emerald-500/10 bg-black/30 px-2 py-1.5">
      <div className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className="font-mono text-[12px] text-zinc-200 tabular-nums">{value}</div>
    </div>
  );
}
