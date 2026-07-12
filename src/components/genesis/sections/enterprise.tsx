"use client";

/** V10 Module 11 — Enterprise Control Center: health scores, isolation, encryption,
 *  RBAC, backups, recovery. Every score explains how it was computed from real state.
 *  Backups/encryption honestly UNCONFIGURED until set; no certification is claimed.
 */

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Chip, HudPanel, GenesisProgress } from "../primitives";

interface Area { area: string; score: number; label: string; howComputed: string }
interface Overview {
  health: { areas: Area[]; overall: number };
  isolation: { score: number; violations: number };
  encryption: { score: number };
  secretLifecycle: { total: number; active: number; revoked: number; staleOver90d: number };
  rbac: { role: string; permissions: string[] }[];
  backups: { backupId: string; status: string }[];
  organizations: number;
  authEnforced: boolean;
}

const scoreColor = (n: number) => (n >= 70 ? "emerald" : n >= 40 ? "amber" : "rose") as "emerald" | "amber" | "rose";

export function Enterprise() {
  const [d, setD] = useState<Overview | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => { try { const r = await fetch("/api/genesis/enterprise").then((x) => x.json()); if (alive) setD(r); } catch { /* empty */ } };
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <HudPanel
      title="Enterprise Control Center"
      subtitle="RBAC · isolation · encryption · backups · compliance — real posture, honest UNCONFIGURED, no certification claimed"
      icon={<ShieldCheck className="w-3.5 h-3.5" />}
      accent="violet"
    >
      {!d ? <Empty text="loading…" /> : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="font-mono border border-violet-500/20 rounded px-2.5 py-1.5">
              <div className="text-[9px] uppercase tracking-wider text-zinc-500">enterprise health</div>
              <div className="flex items-center gap-1.5"><span className="text-sm text-violet-300">{d.health.overall}</span><Chip variant={scoreColor(d.health.overall)}>{d.health.overall >= 70 ? "STRONG" : d.health.overall >= 40 ? "FAIR" : "NEEDS WORK"}</Chip></div>
            </div>
            <span className="font-mono text-[9px] text-zinc-500">{d.organizations} org(s) · auth <span className={d.authEnforced ? "text-emerald-300" : "text-amber-300"}>{d.authEnforced ? "ENFORCED" : "local"}</span> · isolation {d.isolation.violations} violation(s)</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
            {d.health.areas.map((a) => (
              <div key={a.area} className="font-mono text-[10px]" title={a.howComputed}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-zinc-400">{a.area}</span>
                  <div className="flex items-center gap-1.5 flex-1 max-w-[140px]"><GenesisProgress value={a.score} accent={scoreColor(a.score)} /><span className="w-6 text-right text-zinc-300">{a.score}</span></div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {d.rbac.map((r) => (
              <span key={r.role} title={r.permissions.join(", ")} className="font-mono text-[9px] px-1.5 py-0.5 rounded border border-violet-500/20 text-zinc-400">{r.role}:{r.permissions.length}p</span>
            ))}
            <span className="font-mono text-[9px] px-1.5 py-0.5 rounded border border-zinc-600/30 text-zinc-500">keys {d.secretLifecycle.active} active / {d.secretLifecycle.revoked} revoked{d.secretLifecycle.staleOver90d > 0 ? ` · ${d.secretLifecycle.staleOver90d} stale` : ""}</span>
            <span className="font-mono text-[9px] px-1.5 py-0.5 rounded border border-zinc-600/30 text-zinc-500">backups {d.backups.length || "none"}</span>
          </div>
          <div className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider">scores computed from real state (hover for how) · backups/encryption UNCONFIGURED until set · readiness ≠ certification</div>
        </div>
      )}
    </HudPanel>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="font-mono text-[10px] text-zinc-600 py-4 text-center uppercase tracking-wider">{text}</div>;
}
