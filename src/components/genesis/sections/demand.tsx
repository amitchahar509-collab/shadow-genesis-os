"use client";

/** G3 — Demand Graph panel: Product DNA → who needs it, where, how urgently.
 *  Rendered inside the Venture Intelligence tab. Adoption = SIMULATION (labelled).
 */

import { useEffect, useState } from "react";
import { Network } from "lucide-react";
import { Chip, GenesisProgress, HudPanel } from "../primitives";

interface Segment { industry: string; community: string; needScore: number; adoptionProbability: number; marketFit: number; urgency: string; whyNow: string }
interface Match { matchId: string; subject: string; demandScore: number; topSegment: string | null; mode: string; segments: Segment[]; createdAt: string }

const urgencyChip = (u: string): "rose" | "amber" | "zinc" => (u === "HIGH" ? "rose" : u === "MEDIUM" ? "amber" : "zinc");

export function DemandGraph() {
  const [matches, setMatches] = useState<Match[]>([]);
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try { const d = await fetch("/api/genesis/demand?limit=5").then((x) => x.json()); if (active) setMatches(d.matches ?? []); } catch { /* empty */ }
    };
    tick();
    const t = setInterval(tick, 15000);
    return () => { active = false; clearInterval(t); };
  }, []);

  return (
    <HudPanel
      title="Demand Graph"
      subtitle="Product DNA → who needs it · where to reach them · how urgently (adoption = SIMULATION)"
      icon={<Network className="w-3.5 h-3.5" />}
      accent="cyan"
    >
      {matches.length === 0 ? <Empty text="no demand matches yet — POST /api/genesis/demand" /> : (
        <div className="space-y-3">
          {matches.map((m) => (
            <div key={m.matchId} className="border border-cyan-500/10 rounded-sm p-2.5">
              <div className="flex items-center gap-2 flex-wrap font-mono text-[10px] mb-2">
                <span className="text-cyan-300">{m.matchId}</span>
                <span className="flex-1 truncate text-zinc-300" title={m.subject}>{m.subject}</span>
                <span className="text-zinc-500">top: {m.topSegment}</span>
                <Chip variant={m.demandScore >= 50 ? "emerald" : "amber"}>demand {m.demandScore}</Chip>
                <Chip variant="amber">{m.mode}</Chip>
              </div>
              <div className="space-y-1.5">
                {m.segments.slice(0, 4).map((s, i) => (
                  <div key={s.industry} className="flex items-center gap-2 font-mono text-[10px]">
                    <span className="text-zinc-500 w-4">#{i + 1}</span>
                    <span className="text-zinc-200 w-24 truncate">{s.industry}</span>
                    <span className="text-zinc-600 w-40 truncate hidden sm:inline" title={s.community}>{s.community}</span>
                    <div className="flex-1"><GenesisProgress value={s.marketFit} accent="cyan" /></div>
                    <span className="text-zinc-400 w-10 text-right">{s.marketFit}</span>
                    <span className="text-zinc-500 w-12 text-right">{s.adoptionProbability}%</span>
                    <Chip variant={urgencyChip(s.urgency)}>{s.urgency}</Chip>
                  </div>
                ))}
              </div>
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
