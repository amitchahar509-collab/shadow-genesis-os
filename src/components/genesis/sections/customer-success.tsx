"use client";

/** V10 Module 7 — Customer Success panel: real usage, tickets, satisfaction.
 *  Empty/UNKNOWN until a deployed product reports — never fabricated users.
 */

import { useEffect, useState } from "react";
import { HeartPulse } from "lucide-react";
import { Chip, HudPanel } from "../primitives";

interface Labeled { value: number; label: string }
interface Ticket { ticketId: string; productKey: string; subject: string; category: string; priority: string; sentiment: number; status: string; taskId: string | null }
interface Overview {
  behavior: { hasData: boolean; totalEvents: number; activeUsers: number; sessions: number; topFeatures: { feature: string; uses: number }[] };
  satisfaction: { csat: Labeled; sentimentAvg: Labeled; ticketCount: number; praise: number; complaints: number };
  tickets: { total: number; open: number; byCategory: { category: string; count: number }[] };
  recentTickets: Ticket[];
  hasRealData: boolean;
}

const catChip = (c: string): "rose" | "amber" | "emerald" | "cyan" | "zinc" =>
  c === "BUG" || c === "COMPLAINT" ? "rose" : c === "FEATURE_REQUEST" ? "amber" : c === "PRAISE" ? "emerald" : c === "QUESTION" ? "cyan" : "zinc";
const fmt = (m: Labeled, suffix = "") => (m.label === "REAL" ? `${m.value}${suffix}` : m.label);

export function CustomerSuccess() {
  const [d, setD] = useState<Overview | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => { try { const r = await fetch("/api/genesis/customer-success").then((x) => x.json()); if (alive) setD(r); } catch { /* empty */ } };
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <HudPanel
      title="Customer Success"
      subtitle="real usage · drop-off · satisfaction · support — empty until a product reports (never fabricated users)"
      icon={<HeartPulse className="w-3.5 h-3.5" />}
      accent="violet"
    >
      {!d ? <Empty text="loading…" /> : !d.hasRealData ? (
        <div className="space-y-2">
          <Empty text="no real product data yet — layer is honestly empty" />
          <div className="font-mono text-[9px] text-zinc-600 text-center">POST /api/genesis/customer-success {"{action:'event'|'ticket', productKey, …}"} once a product reports</div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-[10px]">
            <Stat name="active users" v={String(d.behavior.activeUsers)} real={d.behavior.hasData} />
            <Stat name="events" v={String(d.behavior.totalEvents)} real={d.behavior.hasData} />
            <Stat name="CSAT" v={fmt(d.satisfaction.csat, "%")} real={d.satisfaction.csat.label === "REAL"} />
            <Stat name="tickets open" v={`${d.tickets.open}/${d.tickets.total}`} real={d.tickets.total > 0} />
          </div>

          {d.behavior.topFeatures.length > 0 && (
            <div className="font-mono text-[9px] text-zinc-500">top features: {d.behavior.topFeatures.slice(0, 5).map((f) => `${f.feature}(${f.uses})`).join(" · ")}</div>
          )}

          {d.recentTickets.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-[10px]">
                <thead><tr className="text-zinc-500 uppercase tracking-wider text-left">
                  <th className="py-1 pr-3">ticket</th><th className="pr-3">category</th><th className="pr-3">pri</th><th className="pr-3">status</th><th>subject</th>
                </tr></thead>
                <tbody>
                  {d.recentTickets.map((t) => (
                    <tr key={t.ticketId} className="border-t border-violet-500/10 text-zinc-300">
                      <td className="py-1 pr-3 text-violet-300">{t.ticketId}{t.taskId && <span className="text-emerald-400"> →task</span>}</td>
                      <td className="pr-3"><Chip variant={catChip(t.category)}>{t.category}</Chip></td>
                      <td className="pr-3 text-zinc-400">{t.priority}</td>
                      <td className="pr-3 text-zinc-400">{t.status}</td>
                      <td className="text-zinc-400 max-w-[260px] truncate">{t.subject}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider">real events + tickets only · recurring issues auto-become improvement tasks · UNKNOWN below sample thresholds</div>
        </div>
      )}
    </HudPanel>
  );
}

function Stat({ name, v, real }: { name: string; v: string; real: boolean }) {
  return (
    <div className="border border-violet-500/15 rounded px-2.5 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{name}</div>
      <div className={real ? "text-violet-300 text-sm" : "text-zinc-500 text-sm"}>{v}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="font-mono text-[10px] text-zinc-600 py-4 text-center uppercase tracking-wider">{text}</div>;
}
