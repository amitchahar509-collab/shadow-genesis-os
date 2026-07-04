"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  BookMarked,
  CheckCircle2,
  CircleDot,
  FlaskConical,
  GitBranch,
  Gavel,
  Layers,
  Microscope,
  Target,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import {
  GenesisSummary,
  ResearchReport,
  parseJson,
} from "@/lib/genesis/types";
import { Chip, HudPanel, timeAgo } from "../primitives";
import { cn } from "@/lib/utils";

export function GenesisStateView({ summary }: { summary: GenesisSummary }) {
  const { state, decisions, checkpoints, recentActivity } = summary;
  const [reports, setReports] = useState<ResearchReport[] | null>(null);

  useEffect(() => {
    let m = true;
    fetch("/api/genesis/research")
      .then((r) => r.json())
      .then((d) => m && setReports((d.reports as ResearchReport[]) ?? []))
      .catch(() => m && setReports([]));
    return () => {
      m = false;
    };
  }, []);

  const completedSystems = parseJson<string[]>(state.completed_systems, []);
  const missingSystems = parseJson<string[]>(state.missing_systems, []);
  const risks = parseJson<{ risk: string; severity: string; mitigation: string }[]>(
    state.technical_risks,
    []
  );
  const nextActions = parseJson<string[]>(state.next_actions, []);

  return (
    <div className="space-y-4">
      {/* Mission */}
      <HudPanel
        title="Initialization · GENESIS_STATE.md"
        subtitle={`cycle ${state.cycle} · phase ${state.phase} · products shipped ${state.products_shipped}`}
        icon={<Target className="w-3.5 h-3.5" />}
        accent="emerald"
        right={<Chip variant="emerald" dot>STATE TRACKED</Chip>}
      >
        <div className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">
          current mission
        </div>
        <p className="font-mono text-[13px] text-zinc-200 leading-relaxed">{state.mission}</p>
        <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-emerald-500/10">
          <Chip variant="cyan">VISION · {state.vision_source}</Chip>
          <Chip variant="amber">CYCLE {state.cycle}</Chip>
          <Chip variant="emerald">PHASE · {state.phase}</Chip>
          <Chip variant="violet">BOOT · {timeAgo(state.boot_epoch)}</Chip>
        </div>
      </HudPanel>

      {/* Systems: completed + missing */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <HudPanel
          title="Completed Systems"
          subtitle={`${completedSystems.length} systems operational`}
          icon={<CheckCircle2 className="w-3.5 h-3.5" />}
          accent="emerald"
        >
          <div className="space-y-1.5 max-h-72 overflow-y-auto scroll-genesis pr-1">
            {completedSystems.map((s, i) => (
              <div
                key={s}
                className="flex items-center gap-2 rounded border border-emerald-500/10 bg-black/20 px-2.5 py-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="font-mono text-[10px] text-zinc-600 w-6">{String(i + 1).padStart(2, "0")}</span>
                <span className="font-mono text-[11px] text-zinc-300">{s}</span>
              </div>
            ))}
          </div>
        </HudPanel>

        <HudPanel
          title="Missing Systems"
          subtitle={`${missingSystems.length} systems not yet built`}
          icon={<XCircle className="w-3.5 h-3.5" />}
          accent="amber"
        >
          <div className="space-y-1.5 max-h-72 overflow-y-auto scroll-genesis pr-1">
            {missingSystems.map((s, i) => (
              <div
                key={s}
                className="flex items-center gap-2 rounded border border-amber-500/15 bg-amber-500/5 px-2.5 py-1.5"
              >
                <CircleDot className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="font-mono text-[10px] text-zinc-600 w-6">{String(i + 1).padStart(2, "0")}</span>
                <span className="font-mono text-[11px] text-zinc-300">{s}</span>
              </div>
            ))}
          </div>
        </HudPanel>
      </div>

      {/* Risks + Next actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <HudPanel
          title="Technical Risks"
          subtitle="tracked · mitigated · never ignored"
          icon={<AlertTriangle className="w-3.5 h-3.5" />}
          accent="rose"
        >
          <div className="space-y-2">
            {risks.map((r, i) => (
              <div key={i} className="rounded border border-rose-500/15 bg-rose-500/5 p-2.5">
                <div className="flex items-start gap-2">
                  <TriangleAlert
                    className={cn(
                      "w-3.5 h-3.5 shrink-0 mt-0.5",
                      r.severity === "HIGH" ? "text-rose-400" : "text-amber-400"
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[11px] text-zinc-200">{r.risk}</span>
                      <Chip variant={r.severity === "HIGH" ? "rose" : "amber"}>{r.severity}</Chip>
                    </div>
                    <p className="font-mono text-[10px] text-zinc-500 mt-1">
                      <span className="text-emerald-400/80">mitigation ›</span> {r.mitigation}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </HudPanel>

        <HudPanel
          title="Next Actions"
          subtitle="CEO priority queue · highest value first"
          icon={<Layers className="w-3.5 h-3.5" />}
          accent="violet"
        >
          <div className="space-y-2">
            {nextActions.map((a, i) => (
              <div
                key={i}
                className="flex items-start gap-2.5 rounded border border-violet-500/15 bg-violet-500/5 px-2.5 py-2"
              >
                <span className="font-mono text-[10px] text-violet-400 mt-0.5 shrink-0">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="font-mono text-[11px] text-zinc-300 leading-relaxed">{a}</span>
              </div>
            ))}
          </div>
        </HudPanel>
      </div>

      {/* CEO decisions + Research */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <HudPanel
          title="CEO Decisions · CEO_DECISIONS.md"
          subtitle={`${decisions.length} strategic decisions logged`}
          icon={<Gavel className="w-3.5 h-3.5" />}
          accent="amber"
        >
          <div className="space-y-2 max-h-96 overflow-y-auto scroll-genesis pr-1">
            {decisions.map((d) => (
              <div key={d.id} className="rounded border border-amber-500/12 bg-black/20 p-2.5">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-mono text-[11px] text-zinc-100">{d.title}</span>
                  <Chip variant={d.impact === "CRITICAL" ? "rose" : d.impact === "HIGH" ? "amber" : "cyan"}>
                    {d.impact}
                  </Chip>
                  <Chip variant={d.status === "EXECUTED" ? "emerald" : d.status === "PROPOSED" ? "amber" : "zinc"}>
                    {d.status}
                  </Chip>
                  <span className="ml-auto font-mono text-[9px] text-zinc-600">{timeAgo(d.createdAt)}</span>
                </div>
                <p className="font-mono text-[10px] text-zinc-500 leading-relaxed">
                  <span className="text-amber-400/70">rationale ›</span> {d.rationale}
                </p>
                <p className="font-mono text-[10px] text-zinc-400 leading-relaxed mt-1">
                  <span className="text-emerald-400/70">decision ›</span> {d.decision}
                </p>
              </div>
            ))}
          </div>
        </HudPanel>

        <HudPanel
          title="Research · RESEARCH_REPORT.md"
          subtitle="every claim needs evidence"
          icon={<Microscope className="w-3.5 h-3.5" />}
          accent="cyan"
        >
          <div className="space-y-2 max-h-96 overflow-y-auto scroll-genesis pr-1">
            {!reports && <div className="py-6 text-center font-mono text-xs text-zinc-600">loading…</div>}
            {reports && reports.length === 0 && (
              <div className="py-6 text-center font-mono text-xs text-zinc-600">no reports</div>
            )}
            {reports?.map((r) => {
              const findings = parseJson<string[]>(r.findings, []);
              const evidence = parseJson<string[]>(r.evidence, []);
              return (
                <div key={r.id} className="rounded border border-cyan-500/12 bg-black/20 p-2.5">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-mono text-[11px] text-zinc-100">{r.topic}</span>
                    <Chip variant="cyan">{r.category}</Chip>
                    <span className="ml-auto font-mono text-[9px] text-zinc-600">
                      conf {r.confidence}%
                    </span>
                  </div>
                  <p className="font-mono text-[10px] text-zinc-400 leading-relaxed mb-1.5">{r.summary}</p>
                  <div className="flex flex-wrap gap-1">
                    {findings.slice(0, 2).map((f, i) => (
                      <span
                        key={i}
                        className="font-mono text-[9px] text-zinc-500 bg-black/30 border border-zinc-700/50 rounded px-1.5 py-0.5"
                      >
                        • {f.length > 50 ? f.slice(0, 50) + "…" : f}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 mt-1.5 pt-1.5 border-t border-cyan-500/10">
                    <BookMarked className="w-2.5 h-2.5 text-cyan-400" />
                    <span className="font-mono text-[9px] text-zinc-600">
                      {evidence.length} evidence sources
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </HudPanel>
      </div>

      {/* Build checkpoints + recent activity summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <HudPanel
          title="Git Checkpoints · v0.7.x"
          subtitle={`${checkpoints.length} recent checkpoints`}
          icon={<GitBranch className="w-3.5 h-3.5" />}
          accent="emerald"
        >
          <div className="space-y-1.5">
            {checkpoints.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded border border-emerald-500/10 bg-black/20 px-3 py-2"
              >
                <GitBranch
                  className={cn(
                    "w-3.5 h-3.5 shrink-0",
                    c.status === "PASSED"
                      ? "text-emerald-400"
                      : c.status === "ROLLBACK"
                      ? "text-rose-400"
                      : "text-amber-400"
                  )}
                />
                <span className="font-mono text-[11px] text-emerald-400 w-14 shrink-0">{c.version}</span>
                <span className="font-mono text-[10px] text-zinc-500 w-16 shrink-0">{c.type}</span>
                <span className="font-mono text-[10px] text-zinc-400 truncate flex-1">{c.summary}</span>
                <span className="font-mono text-[9px] text-zinc-600 shrink-0 hidden sm:inline">
                  {c.testsPassed}✓ / {c.testsFailed}✗
                </span>
                <Chip variant={c.status === "PASSED" ? "emerald" : c.status === "ROLLBACK" ? "rose" : "amber"}>
                  {c.status}
                </Chip>
              </div>
            ))}
          </div>
        </HudPanel>

        <HudPanel
          title="Episodic Activity · Last 15"
          subtitle="recent system events"
          icon={<FlaskConical className="w-3.5 h-3.5" />}
          accent="violet"
        >
          <div className="space-y-1.5 max-h-72 overflow-y-auto scroll-genesis pr-1">
            {recentActivity.slice(0, 15).map((a) => (
              <div key={a.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-violet-500/5">
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    a.level === "SUCCESS"
                      ? "bg-emerald-400"
                      : a.level === "ERROR"
                      ? "bg-rose-400"
                      : a.level === "WARNING"
                      ? "bg-amber-400"
                      : "bg-cyan-400"
                  )}
                />
                <span className="font-mono text-[10px] text-zinc-300 truncate flex-1">{a.detail}</span>
                <span className="font-mono text-[9px] text-zinc-600 shrink-0">{timeAgo(a.createdAt)}</span>
              </div>
            ))}
          </div>
        </HudPanel>
      </div>
    </div>
  );
}
