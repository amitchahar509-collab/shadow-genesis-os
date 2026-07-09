"use client";

/** G6 — Agent Arena panel: teams compete, a judge picks the winner (data-driven).
 *  Rendered inside the Venture Intelligence tab.
 */

import { useEffect, useState } from "react";
import { Swords, Trophy } from "lucide-react";
import { Chip, GenesisProgress, HudPanel } from "../primitives";

interface Entry { entryId: string; team: string; focus: string; totalScore: number; ventureScore: number; customerReality: number; truthScore: number; rank: number; verdict: string }
interface Competition { competitionId: string; mission: string; status: string; winnerTeam: string | null; winnerScore: number; rationale: string; boardVerdict: string | null; mode: string; entries: Entry[]; createdAt: string }

const teamAccent = (t: string): "violet" | "cyan" | "amber" => (t === "ALPHA" ? "violet" : t === "BETA" ? "cyan" : "amber");
const verdictChip = (v: string | null): "emerald" | "amber" | "rose" | "zinc" =>
  v === "WINNER" || v === "GO" ? "emerald" : v === "RUNNER_UP" || v === "CONDITIONAL" ? "amber" : v === "REJECTED" || v === "NO_GO" ? "rose" : "zinc";

export function AgentArena() {
  const [comps, setComps] = useState<Competition[]>([]);
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try { const d = await fetch("/api/genesis/arena?limit=6").then((x) => x.json()); if (active) setComps(d.competitions ?? []); } catch { /* empty */ }
    };
    tick();
    const t = setInterval(tick, 15000);
    return () => { active = false; clearInterval(t); };
  }, []);

  return (
    <HudPanel
      title="Agent Arena"
      subtitle="ALPHA (innovation) · BETA (reliability) · GAMMA (growth) compete — judge picks the winner by score, never hardcoded"
      icon={<Swords className="w-3.5 h-3.5" />}
      accent="violet"
    >
      {comps.length === 0 ? <Empty text="no competitions yet — POST /api/genesis/arena (ADMIN)" /> : (
        <div className="space-y-3">
          {comps.map((c) => (
            <div key={c.competitionId} className="border border-violet-500/10 rounded-sm p-2.5">
              <div className="flex items-center gap-2 flex-wrap font-mono text-[10px] mb-2">
                <span className="text-violet-300">{c.competitionId}</span>
                <span className="flex-1 truncate text-zinc-300" title={c.mission}>{c.mission}</span>
                {c.winnerTeam && <Chip variant="emerald"><Trophy className="w-3 h-3 inline mr-1" />{c.winnerTeam} {c.winnerScore}</Chip>}
                {c.boardVerdict && <Chip variant={verdictChip(c.boardVerdict)}>board {c.boardVerdict}</Chip>}
                <Chip variant={c.mode === "HEURISTIC" ? "amber" : "cyan"}>{c.mode}</Chip>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {c.entries.map((e) => (
                  <div key={e.entryId} className={`rounded-sm p-2 border ${e.verdict === "WINNER" ? "border-emerald-500/40 bg-emerald-500/5" : "border-zinc-700/40"}`}>
                    <div className="flex items-center gap-1.5 font-mono text-[10px] mb-1">
                      <Chip variant={teamAccent(e.team)}>{e.team}</Chip>
                      <span className="text-zinc-500">{e.focus}</span>
                      <span className="ml-auto text-zinc-300 tabular-nums">#{e.rank}</span>
                    </div>
                    <div className="font-mono text-sm text-zinc-100 tabular-nums">{e.totalScore}<span className="text-zinc-600 text-[10px]">/100</span></div>
                    <GenesisProgress value={e.totalScore} accent={teamAccent(e.team)} />
                    <div className="font-mono text-[9px] text-zinc-500 mt-1">V {e.ventureScore} · C {e.customerReality} · T {e.truthScore}%</div>
                  </div>
                ))}
              </div>
              {c.rationale && <div className="font-mono text-[9px] text-zinc-500 mt-2">{c.rationale}</div>}
            </div>
          ))}
        </div>
      )}
    </HudPanel>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="font-mono text-[10px] text-zinc-600 py-4 text-center uppercase tracking-wider">{text}</div>;
}
