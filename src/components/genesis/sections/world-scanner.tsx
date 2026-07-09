"use client";

/** G1 — World Scanner panel: problems discovered from Genesis's own accumulated reality.
 *  Rendered inside the Venture Intelligence tab.
 */

import { useEffect, useState } from "react";
import { Radar } from "lucide-react";
import { Chip, GenesisProgress, HudPanel } from "../primitives";

interface Problem { problemId: string; statement: string; category: string; whoSuffers: string; frequency: number; urgency: string; opportunityScore: number; truthScore: number; dataSource: string; sourceCount: number; status: string }

const sourceChip = (s: string): "cyan" | "amber" | "rose" | "violet" =>
  s === "REALITY" ? "cyan" : s === "MARKET_GAP" ? "amber" : s === "FAILED_VENTURE" ? "rose" : "violet";
const urgencyChip = (u: string): "rose" | "amber" | "zinc" => (u === "HIGH" ? "rose" : u === "MEDIUM" ? "amber" : "zinc");

export function WorldScanner() {
  const [problems, setProblems] = useState<Problem[]>([]);
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try { const d = await fetch("/api/genesis/world?limit=10").then((x) => x.json()); if (active) setProblems(d.problems ?? []); } catch { /* empty */ }
    };
    tick();
    const t = setInterval(tick, 15000);
    return () => { active = false; clearInterval(t); };
  }, []);

  return (
    <HudPanel
      title="World Scanner"
      subtitle="problems discovered from Genesis's own reality — feedback signals · demand gaps · failed ventures"
      icon={<Radar className="w-3.5 h-3.5" />}
      accent="cyan"
    >
      {problems.length === 0 ? <Empty text="no problems discovered yet — POST /api/genesis/world {action:'scan'}" /> : (
        <ul className="space-y-2">
          {problems.map((p) => (
            <li key={p.problemId} className="font-mono text-[10px] text-zinc-300">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-cyan-300">{p.problemId}</span>
                <Chip variant={sourceChip(p.dataSource)}>{p.dataSource}</Chip>
                <Chip variant={urgencyChip(p.urgency)}>{p.urgency}</Chip>
                <span className="text-zinc-500">×{p.frequency}</span>
                <span className="text-zinc-600">truth {p.truthScore}%</span>
                {p.status === "PROMOTED" && <Chip variant="emerald">promoted</Chip>}
                <span className="ml-auto text-zinc-400 tabular-nums">opp {p.opportunityScore}</span>
              </div>
              <div className="text-zinc-400 truncate mt-0.5" title={p.statement}>{p.statement}</div>
              <GenesisProgress value={p.opportunityScore} accent="cyan" />
            </li>
          ))}
        </ul>
      )}
      <div className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider mt-2">real internal signals only (no fabricated demand) · web scanning activates with a search key</div>
    </HudPanel>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="font-mono text-[10px] text-zinc-600 py-4 text-center uppercase tracking-wider">{text}</div>;
}
