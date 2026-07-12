"use client";

/** V10 Module 10 — Action Connectors panel: connector health, approval queue,
 *  execution history, dead-letter. Every external mutation is approval-gated and
 *  delivery-verified from real responses — nothing is fabricated.
 */

import { useEffect, useState } from "react";
import { Plug } from "lucide-react";
import { Chip, HudPanel } from "../primitives";

interface Conn { name: string; category: string; available: boolean; status: string; operations: string[] }
interface Hist { actionId: string; connector: string; operation: string; companyKey: string; status: string; attempts: number; latencyMs: number; deliveryVerified: boolean; externalId: string | null }
interface Overview {
  connectors: Conn[]; configuredCount: number; pendingApprovals: number; deadLetter: number;
  byStatus: { status: string; count: number }[]; history: Hist[];
}

const statusChip = (s: string): "emerald" | "amber" | "rose" | "zinc" =>
  s === "DELIVERED" ? "emerald" : s === "PENDING_APPROVAL" || s === "APPROVED" || s === "EXECUTING" ? "amber" : s === "DEAD_LETTER" || s === "FAILED" || s === "REJECTED" ? "rose" : "zinc";

export function ActionConnectors() {
  const [d, setD] = useState<Overview | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => { try { const r = await fetch("/api/genesis/actions").then((x) => x.json()); if (alive) setD(r); } catch { /* empty */ } };
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <HudPanel
      title="Action Connectors"
      subtitle="GitHub · Slack · Notion · Linear · Jira · HubSpot · Google — approval-gated, delivery-verified (never faked)"
      icon={<Plug className="w-3.5 h-3.5" />}
      accent="cyan"
    >
      {!d ? <Empty text="loading…" /> : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {d.connectors.map((c) => (
              <span key={c.name} title={`${c.category} · ops: ${c.operations.join(", ")}`} className={`font-mono text-[9px] px-1.5 py-0.5 rounded border ${c.available ? "border-cyan-500/30 text-cyan-300" : "border-zinc-700 text-zinc-600"}`}>{c.name}:{c.available ? "connected" : "unconfig"}</span>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 font-mono text-[9px] text-zinc-500">
            <span>configured <span className="text-cyan-300">{d.configuredCount}</span></span>
            <span>pending approval <span className="text-amber-300">{d.pendingApprovals}</span></span>
            <span>dead-letter <span className={d.deadLetter > 0 ? "text-rose-300" : "text-zinc-400"}>{d.deadLetter}</span></span>
          </div>

          {d.history.length === 0 ? <Empty text="no actions yet — POST /api/genesis/actions {action:'request', connector, operation, payload}" /> : (
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-[10px]">
                <thead><tr className="text-zinc-500 uppercase tracking-wider text-left">
                  <th className="py-1 pr-3">action</th><th className="pr-3">connector</th><th className="pr-3">company</th><th className="pr-3">status</th><th className="pr-3">del?</th><th>ext id</th>
                </tr></thead>
                <tbody>
                  {d.history.map((a) => (
                    <tr key={a.actionId} className="border-t border-cyan-500/10 text-zinc-300">
                      <td className="py-1 pr-3 text-cyan-300">{a.actionId}</td>
                      <td className="pr-3 text-zinc-400">{a.connector}.{a.operation}</td>
                      <td className="pr-3 text-zinc-500">{a.companyKey}</td>
                      <td className="pr-3"><Chip variant={statusChip(a.status)}>{a.status}</Chip></td>
                      <td className="pr-3">{a.deliveryVerified ? "✓" : "—"}</td>
                      <td className="text-zinc-400">{a.externalId ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider">every mutation needs a human approval · delivery verified from the real provider id · credentials never persisted</div>
        </div>
      )}
    </HudPanel>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="font-mono text-[10px] text-zinc-600 py-4 text-center uppercase tracking-wider">{text}</div>;
}
