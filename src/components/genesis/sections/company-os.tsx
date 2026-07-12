"use client";

/** V10 Module 9 — Company OS panel: a portfolio roll-up of every company's real
 *  per-module data (CRM, finance, analytics, support). $0/empty is honest.
 */

import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { Chip, HudPanel } from "../primitives";

interface Row { key: string; name: string; status: string; leads: number; mrrUsd: number; hasRevenue: boolean; activeUsers: number; openTickets: number }
interface Overview { companies: number; portfolio: Row[] }

const statusChip = (s: string): "emerald" | "amber" | "zinc" => (s === "ACTIVE" ? "emerald" : s === "PAUSED" ? "amber" : "zinc");

export function CompanyOS() {
  const [d, setD] = useState<Overview | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => { try { const r = await fetch("/api/genesis/company-os").then((x) => x.json()); if (alive) setD(r); } catch { /* empty */ } };
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <HudPanel
      title="Company OS"
      subtitle="per-company CRM · finance · analytics · support — aggregated from real module data (never fabricated)"
      icon={<Building2 className="w-3.5 h-3.5" />}
      accent="cyan"
    >
      {!d ? <Empty text="loading…" /> : d.portfolio.length === 0 ? (
        <Empty text="no companies yet — run a venture or POST /api/genesis/company-os {action:'ensure', key}" />
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full font-mono text-[10px]">
              <thead><tr className="text-zinc-500 uppercase tracking-wider text-left">
                <th className="py-1 pr-3">company</th><th className="pr-3">status</th><th className="pr-3">leads</th><th className="pr-3">MRR</th><th className="pr-3">users</th><th>open tickets</th>
              </tr></thead>
              <tbody>
                {d.portfolio.map((c) => (
                  <tr key={c.key} className="border-t border-cyan-500/10 text-zinc-300">
                    <td className="py-1 pr-3"><span className="text-cyan-300">{c.name}</span> <span className="text-zinc-600">{c.key}</span></td>
                    <td className="pr-3"><Chip variant={statusChip(c.status)}>{c.status}</Chip></td>
                    <td className="pr-3">{c.leads}</td>
                    <td className="pr-3">{c.hasRevenue ? <span className="text-emerald-300">${c.mrrUsd}</span> : <span className="text-zinc-600">$0</span>}</td>
                    <td className="pr-3">{c.activeUsers}</td>
                    <td>{c.openTickets > 0 ? <Chip variant="amber">{c.openTickets}</Chip> : "0"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider">{d.companies} company workspace(s) · each section reads its owning module's real rows · GET ?workspace=&lt;key&gt; for the full 10-section view</div>
        </div>
      )}
    </HudPanel>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="font-mono text-[10px] text-zinc-600 py-4 text-center uppercase tracking-wider">{text}</div>;
}
