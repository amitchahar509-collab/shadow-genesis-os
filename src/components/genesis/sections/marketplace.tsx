"use client";

/** G8 — App Demand Marketplace panel: listed apps, category coverage, and demand gaps.
 *  Rendered inside the Venture Intelligence tab.
 */

import { useEffect, useState } from "react";
import { Store } from "lucide-react";
import { Chip, HudPanel } from "../primitives";

interface App { appId: string; name: string; category: string; topSegment: string | null; demandScore: number; source: string; problem: string }
interface Stats { total: number; byCategory: Record<string, number>; coveredSegments: string[]; demandGaps: string[]; avgDemandScore: number }

export function Marketplace() {
  const [apps, setApps] = useState<App[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const [a, s] = await Promise.all([
          fetch("/api/genesis/marketplace?limit=8").then((x) => x.json()),
          fetch("/api/genesis/marketplace?stats=1").then((x) => x.json()),
        ]);
        if (active) { setApps(a.apps ?? []); setStats(s.stats ?? null); }
      } catch { /* empty */ }
    };
    tick();
    const t = setInterval(tick, 15000);
    return () => { active = false; clearInterval(t); };
  }, []);

  return (
    <HudPanel
      title="App Demand Marketplace"
      subtitle="every app carries its Product DNA + demand match — problems ↔ products"
      icon={<Store className="w-3.5 h-3.5" />}
      accent="emerald"
      right={stats ? <Chip variant="emerald">{stats.total} listed · avg demand {stats.avgDemandScore}</Chip> : undefined}
    >
      {apps.length === 0 ? <Empty text="no apps listed — POST /api/genesis/marketplace" /> : (
        <div className="space-y-3">
          <ul className="space-y-1.5">
            {apps.map((a) => (
              <li key={a.appId} className="font-mono text-[10px] text-zinc-300 flex items-center gap-2 flex-wrap">
                <span className="text-emerald-400">{a.appId}</span>
                <span className="text-zinc-100 truncate max-w-[160px]" title={a.problem}>{a.name}</span>
                <Chip variant="cyan">{a.category}</Chip>
                {a.topSegment && <span className="text-zinc-500">→ {a.topSegment}</span>}
                <Chip variant={a.demandScore >= 50 ? "emerald" : "amber"}>demand {a.demandScore}</Chip>
                <Chip variant="zinc">{a.source}</Chip>
              </li>
            ))}
          </ul>
          {stats && stats.demandGaps.length > 0 && (
            <div className="font-mono text-[10px] border-t border-emerald-500/10 pt-2">
              <span className="text-zinc-500 uppercase tracking-wider">Demand gaps (unserved segments = opportunity signals): </span>
              <span className="text-amber-400">{stats.demandGaps.join(", ")}</span>
            </div>
          )}
        </div>
      )}
    </HudPanel>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="font-mono text-[10px] text-zinc-600 py-4 text-center uppercase tracking-wider">{text}</div>;
}
