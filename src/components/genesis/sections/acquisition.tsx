"use client";

/** V10 Module 2 — Customer Acquisition panel: real leads, ICP funnel, approval queue.
 *  Trust the labels: leads are REAL (evidence URLs); scores/intent are HEURISTIC.
 *  Nothing is ever sent from here without an explicit human approval + send.
 */

import { useEffect, useState } from "react";
import { Users, ExternalLink } from "lucide-react";
import { Chip, HudPanel } from "../primitives";

interface Lead { leadId: string; name: string; industry: string; matchTier: string; icpScore: number; status: string; evidenceUrl: string; contactType: string; dataLabel: string }
interface Overview {
  leadCount: number;
  funnel: Record<string, number>;
  industries: { industry: string; count: number }[];
  approvalQueue: { draftId: string; leadId: string; channel: string; subject: string }[];
  interactions: number;
  connectorHealth: { name: string; kind: string; available: boolean; note: string }[];
  topLeads: Lead[];
}

const tierChip = (t: string): "emerald" | "amber" | "zinc" => (t === "HIGH" ? "emerald" : t === "MEDIUM" ? "amber" : "zinc");
const FUNNEL_ORDER = ["NEW", "QUALIFIED", "DRAFTED", "CONTACTED", "REPLIED", "CUSTOMER", "LOST"];

export function Acquisition() {
  const [d, setD] = useState<Overview | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => { try { const r = await fetch("/api/genesis/crm").then((x) => x.json()); if (alive) setD(r); } catch { /* empty */ } };
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <HudPanel
      title="Customer Acquisition"
      subtitle="real public leads · HEURISTIC fit scoring · every send is human-approved — nothing auto-contacts"
      icon={<Users className="w-3.5 h-3.5" />}
      accent="emerald"
    >
      {!d ? <Empty text="loading…" /> : (
        <div className="space-y-3">
          {/* funnel */}
          <div className="flex flex-wrap gap-1.5">
            {FUNNEL_ORDER.map((s) => (
              <div key={s} className="font-mono text-[9px] px-2 py-1 rounded border border-emerald-500/20 text-zinc-400">
                {s} <span className="text-emerald-300">{d.funnel[s] ?? 0}</span>
              </div>
            ))}
            <div className="font-mono text-[9px] px-2 py-1 rounded border border-zinc-600/30 text-zinc-500">approvals pending <span className="text-amber-300">{d.approvalQueue.length}</span></div>
          </div>

          {/* top leads */}
          {d.topLeads.length === 0 ? <Empty text="no leads — POST /api/genesis/crm {action:'run', subject, problem}" /> : (
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-[10px]">
                <thead><tr className="text-zinc-500 uppercase tracking-wider text-left">
                  <th className="py-1 pr-3">lead</th><th className="pr-3">industry</th><th className="pr-3">fit</th><th className="pr-3">score</th><th className="pr-3">status</th><th>evidence</th>
                </tr></thead>
                <tbody>
                  {d.topLeads.map((l) => (
                    <tr key={l.leadId} className="border-t border-emerald-500/10 text-zinc-300">
                      <td className="py-1 pr-3">{l.name} <Chip variant="zinc">{l.dataLabel}</Chip></td>
                      <td className="pr-3 text-zinc-400">{l.industry}</td>
                      <td className="pr-3"><Chip variant={tierChip(l.matchTier)}>{l.matchTier}</Chip></td>
                      <td className="pr-3">{l.icpScore}</td>
                      <td className="pr-3 text-zinc-400">{l.status}</td>
                      <td><a href={l.evidenceUrl} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline inline-flex items-center gap-0.5">src <ExternalLink className="w-2.5 h-2.5" /></a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* industries + connector health */}
          <div className="flex flex-wrap gap-3 text-[9px] font-mono">
            <div className="text-zinc-500">industries: {d.industries.slice(0, 5).map((i) => `${i.industry}(${i.count})`).join(" · ") || "—"}</div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {d.connectorHealth.map((c) => (
              <span key={c.name} title={c.note} className={`font-mono text-[9px] px-1.5 py-0.5 rounded border ${c.available ? "border-emerald-500/30 text-emerald-300" : "border-zinc-700 text-zinc-600"}`}>{c.name}:{c.available ? "up" : c.kind === "KEY_REQUIRED" ? "key" : "n/a"}</span>
            ))}
          </div>
          <div className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider">leads = REAL public entities w/ evidence URLs · fit/intent = HEURISTIC · outreach stays DRAFT until a human approves & sends</div>
        </div>
      )}
    </HudPanel>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="font-mono text-[10px] text-zinc-600 py-4 text-center uppercase tracking-wider">{text}</div>;
}
