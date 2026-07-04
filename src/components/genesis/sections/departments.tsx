"use client";

import { useMemo, useState } from "react";
import {
  BrainCircuit,
  Crown,
  Cpu,
  DraftingCompass,
  Palette,
  ShieldCheck,
  Telescope,
  Terminal,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  GenesisSummary,
  DEPARTMENT_META,
  STATUS_COLOR,
  parseJson,
} from "@/lib/genesis/types";
import { Chip, GenesisProgress, HudPanel } from "../primitives";
import { cn } from "@/lib/utils";

const ICONS: Record<string, React.ReactNode> = {
  ceo: <Crown className="w-4 h-4" />,
  research: <Telescope className="w-4 h-4" />,
  product: <DraftingCompass className="w-4 h-4" />,
  engineering: <Terminal className="w-4 h-4" />,
  ai_systems: <BrainCircuit className="w-4 h-4" />,
  design: <Palette className="w-4 h-4" />,
  growth: <TrendingUp className="w-4 h-4" />,
  quality: <ShieldCheck className="w-4 h-4" />,
};

const ACCENT_RING: Record<string, string> = {
  emerald: "border-emerald-500/40 text-emerald-400 bg-emerald-500/5",
  cyan: "border-cyan-500/40 text-cyan-400 bg-cyan-500/5",
  amber: "border-amber-500/40 text-amber-400 bg-amber-500/5",
  rose: "border-rose-500/40 text-rose-400 bg-rose-500/5",
  violet: "border-violet-500/40 text-violet-400 bg-violet-500/5",
};

export function Departments({ summary }: { summary: GenesisSummary }) {
  const { departments, tasks } = summary;
  const [expanded, setExpanded] = useState<string | null>("engineering");

  const tasksByDept = useMemo(() => {
    const m: Record<string, typeof tasks> = {};
    tasks.forEach((t) => {
      (m[t.department] ??= []).push(t);
    });
    return m;
  }, [tasks]);

  return (
    <div className="space-y-4">
      <HudPanel
        title="Company Structure · Autonomous Departments"
        subtitle="8 departments · 16 agents · distributed execution"
        icon={<Cpu className="w-3.5 h-3.5" />}
        accent="emerald"
        right={<Chip variant="emerald" dot>ALL DEPTS ONLINE</Chip>}
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <SummaryStat label="Departments" value={String(departments.length)} accent="emerald" />
          <SummaryStat
            label="Active Agents"
            value={String(departments.reduce((s, d) => s + d.activeAgents, 0))}
            accent="cyan"
          />
          <SummaryStat
            label="Completed Tasks"
            value={String(departments.reduce((s, d) => s + d.completedTasks, 0))}
            accent="amber"
          />
          <SummaryStat
            label="Avg Health"
            value={`${Math.round(
              departments.reduce((s, d) => s + d.health, 0) / departments.length
            )}%`}
            accent="violet"
          />
        </div>
      </HudPanel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {departments.map((d) => {
          const meta = DEPARTMENT_META[d.key];
          const accent = meta?.accent ?? "emerald";
          const isExp = expanded === d.key;
          const deptTasks = tasksByDept[d.key] ?? [];
          const metrics = parseJson<Record<string, number | string>>(d.metrics, {});
          return (
            <div
              key={d.key}
              className={cn(
                "genesis-panel genesis-panel-hover rounded-md transition-all",
                isExp && "border-emerald-500/40"
              )}
            >
              {/* header */}
              <button
                onClick={() => setExpanded(isExp ? null : d.key)}
                className="w-full flex items-center gap-3 p-3 text-left"
              >
                <span
                  className={cn(
                    "w-9 h-9 rounded-sm border flex items-center justify-center shrink-0",
                    ACCENT_RING[accent]
                  )}
                >
                  {ICONS[d.key]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-mono text-[13px] text-zinc-100 tracking-wide">{d.name}</h3>
                    <Chip
                      variant={d.status === "ACTIVE" ? "emerald" : d.status === "IDLE" ? "zinc" : "rose"}
                      dot
                    >
                      {d.status}
                    </Chip>
                  </div>
                  <p className="font-mono text-[10px] text-zinc-500 mt-0.5 line-clamp-1">
                    {d.mission}
                  </p>
                </div>
                <span className="font-mono text-[10px] text-zinc-600 shrink-0">
                  {isExp ? "− collapse" : "+ expand"}
                </span>
              </button>

              {/* health/load bars */}
              <div className="px-3 pb-3 grid grid-cols-2 gap-3">
                <div>
                  <div className="flex justify-between font-mono text-[10px] mb-1">
                    <span className="text-zinc-500">HEALTH</span>
                    <span className={cn(accent === "rose" ? "text-rose-400" : accent === "amber" ? "text-amber-400" : "text-emerald-400")}>{d.health}%</span>
                  </div>
                  <GenesisProgress value={d.health} accent={accent} />
                </div>
                <div>
                  <div className="flex justify-between font-mono text-[10px] mb-1">
                    <span className="text-zinc-500">LOAD</span>
                    <span className="text-cyan-400">{d.load}%</span>
                  </div>
                  <GenesisProgress value={d.load} accent="cyan" showShimmer={d.load > 60} />
                </div>
              </div>

              {/* quick stats */}
              <div className="px-3 pb-3 grid grid-cols-3 gap-2">
                <MiniStat icon={<Users className="w-3 h-3" />} label="agents" value={String(d.activeAgents)} />
                <MiniStat icon={<ShieldCheck className="w-3 h-3" />} label="done" value={String(d.completedTasks)} />
                <MiniStat icon={<Cpu className="w-3 h-3" />} label="pending" value={String(d.pendingTasks)} />
              </div>

              {/* expanded detail */}
              {isExp && (
                <div className="border-t border-emerald-500/10 p-3 space-y-3">
                  {/* mission full */}
                  <div>
                    <div className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider mb-1">mission</div>
                    <p className="font-mono text-[11px] text-zinc-400 leading-relaxed">{d.mission}</p>
                  </div>

                  {/* metrics */}
                  <div>
                    <div className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider mb-1.5">telemetry</div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {Object.entries(metrics).map(([k, v]) => (
                        <div key={k} className="rounded border border-emerald-500/10 bg-black/30 px-2 py-1.5">
                          <div className="font-mono text-[9px] text-zinc-600 uppercase tracking-wide truncate">
                            {k.replace(/([A-Z])/g, " $1").trim()}
                          </div>
                          <div className="font-mono text-[12px] text-emerald-400">
                            {typeof v === "number" && k.includes("rate") || k.includes("coverage") || k.includes("accuracy") || k.includes("savings")
                              ? `${Math.round(v * 100)}%`
                              : typeof v === "number"
                              ? v.toLocaleString()
                              : String(v)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* department tasks */}
                  <div>
                    <div className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider mb-1.5">
                      owned tasks · {deptTasks.length}
                    </div>
                    <div className="space-y-1 max-h-44 overflow-y-auto scroll-genesis pr-1">
                      {deptTasks.length === 0 && (
                        <div className="font-mono text-[11px] text-zinc-600 py-2">no tasks assigned</div>
                      )}
                      {deptTasks.map((t) => (
                        <div key={t.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-emerald-500/5 border border-transparent hover:border-emerald-500/15">
                          <span className="font-mono text-[9px] text-emerald-400/70 w-9 shrink-0">{t.taskId}</span>
                          <span className="font-mono text-[11px] text-zinc-300 truncate flex-1">{t.title}</span>
                          <span className={cn("chip", STATUS_COLOR[t.status])}>
                            {t.status.replace("_", " ")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SummaryStat({
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

function MiniStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded border border-emerald-500/10 bg-black/20 px-2 py-1.5">
      <span className="text-zinc-500">{icon}</span>
      <span className="font-mono text-[9px] text-zinc-600 uppercase">{label}</span>
      <span className="ml-auto font-mono text-[12px] text-zinc-200 tabular-nums">{value}</span>
    </div>
  );
}
