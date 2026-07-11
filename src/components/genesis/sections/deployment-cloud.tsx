"use client";

/** V10 Module 4 — Deployment Cloud panel: provider readiness, deployments, health.
 *  Cloud deploys are human-approval gated; health is a REAL HTTP check. No fabricated
 *  deploys — providers show "connected" only with a real API key.
 */

import { useEffect, useState } from "react";
import { Rocket } from "lucide-react";
import { Chip, HudPanel } from "../primitives";

interface Provider { name: string; kind: string; available: boolean; note: string }
interface Deployment { deploymentId: string; provider: string; url: string | null; status: string; health: string; region: string | null }
interface Overview {
  providers: Provider[];
  deployments: Deployment[];
  byProvider: { provider: string; count: number }[];
  pendingApprovals: number;
  note: string;
}

const statusChip = (s: string): "emerald" | "amber" | "rose" | "zinc" =>
  s === "DEPLOYED" ? "emerald" : s === "AWAITING_APPROVAL" || s === "PLANNED" ? "amber" : s === "FAILED" || s === "UNHEALTHY" || s === "ROLLED_BACK" ? "rose" : "zinc";
const healthChip = (h: string): "emerald" | "rose" | "zinc" => (h === "HEALTHY" ? "emerald" : h === "UNHEALTHY" || h === "NOT_RUNNING" ? "rose" : "zinc");

export function DeploymentCloud() {
  const [d, setD] = useState<Overview | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => { try { const r = await fetch("/api/genesis/deploy").then((x) => x.json()); if (alive) setD(r); } catch { /* empty */ } };
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <HudPanel
      title="Deployment Cloud"
      subtitle="Vercel · Cloudflare · Railway · Render · Docker — human-approved deploys, real health checks"
      icon={<Rocket className="w-3.5 h-3.5" />}
      accent="cyan"
    >
      {!d ? <Empty text="loading…" /> : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {d.providers.map((p) => (
              <span key={p.name} title={p.note} className={`font-mono text-[9px] px-1.5 py-0.5 rounded border ${p.available ? "border-cyan-500/30 text-cyan-300" : "border-zinc-700 text-zinc-600"}`}>{p.name}:{p.available ? "connected" : "no key"}</span>
            ))}
            {d.pendingApprovals > 0 && <span className="font-mono text-[9px] px-1.5 py-0.5 rounded border border-amber-500/30 text-amber-300">{d.pendingApprovals} awaiting approval</span>}
          </div>

          {d.deployments.length === 0 ? <Empty text="no cloud deployments — POST /api/genesis/deploy {action:'plan', provider}" /> : (
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-[10px]">
                <thead><tr className="text-zinc-500 uppercase tracking-wider text-left">
                  <th className="py-1 pr-3">id</th><th className="pr-3">provider</th><th className="pr-3">status</th><th className="pr-3">health</th><th>url</th>
                </tr></thead>
                <tbody>
                  {d.deployments.map((x) => (
                    <tr key={x.deploymentId} className="border-t border-cyan-500/10 text-zinc-300">
                      <td className="py-1 pr-3 text-cyan-300">{x.deploymentId}</td>
                      <td className="pr-3 text-zinc-400">{x.provider}</td>
                      <td className="pr-3"><Chip variant={statusChip(x.status)}>{x.status}</Chip></td>
                      <td className="pr-3"><Chip variant={healthChip(x.health)}>{x.health}</Chip></td>
                      <td>{x.url ? <a href={x.url} target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline">{x.url.replace(/^https?:\/\//, "")}</a> : <span className="text-zinc-600">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider">{d.note}</div>
        </div>
      )}
    </HudPanel>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="font-mono text-[10px] text-zinc-600 py-4 text-center uppercase tracking-wider">{text}</div>;
}
