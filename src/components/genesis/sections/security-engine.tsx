"use client";

/** V10 Module 6 — Security panel: threat score, event timeline, findings.
 *  Every event is a REAL detection with redacted evidence — never fabricated.
 */

import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Chip, HudPanel } from "../primitives";

interface Ev { eventId: string; kind: string; severity: string; verdict: string; label: string; detail: string; source: string; status: string }
interface Overview {
  threatScore: number; threatLevel: string; openEvents: number; totalEvents: number; openSourceFindings: number;
  byKind: { kind: string; count: number }[]; bySeverity: { severity: string; count: number }[];
  authEnforced: boolean; timeline: Ev[];
}

const sevChip = (s: string): "rose" | "amber" | "cyan" | "zinc" => (s === "CRITICAL" || s === "HIGH" ? "rose" : s === "MEDIUM" ? "amber" : s === "LOW" ? "cyan" : "zinc");
const levelChip = (l: string): "rose" | "amber" | "emerald" => (l === "HIGH" ? "rose" : l === "ELEVATED" || l === "LOW" ? "amber" : "emerald");
const verdictChip = (v: string): "rose" | "amber" | "emerald" => (v === "BLOCKED" ? "rose" : v === "WARNING" ? "amber" : "emerald");

export function SecurityEngine() {
  const [d, setD] = useState<Overview | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => { try { const r = await fetch("/api/genesis/security/engine").then((x) => x.json()); if (alive) setD(r); } catch { /* empty */ } };
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <HudPanel
      title="Security Engine"
      subtitle="secret detection · prompt firewall · SBOM · sandbox guard — real detections, redacted evidence"
      icon={<ShieldAlert className="w-3.5 h-3.5" />}
      accent="rose"
    >
      {!d ? <Empty text="loading…" /> : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-mono border border-rose-500/20 rounded px-2.5 py-1.5">
              <div className="text-[9px] uppercase tracking-wider text-zinc-500">threat score</div>
              <div className="flex items-center gap-1.5"><span className="text-sm text-rose-300">{d.threatScore}</span><Chip variant={levelChip(d.threatLevel)}>{d.threatLevel}</Chip></div>
            </div>
            <div className="font-mono text-[9px] text-zinc-500 space-y-0.5">
              <div>open events <span className="text-zinc-300">{d.openEvents}</span> · source findings <span className="text-zinc-300">{d.openSourceFindings}</span></div>
              <div>auth <span className={d.authEnforced ? "text-emerald-300" : "text-amber-300"}>{d.authEnforced ? "ENFORCED" : "local (unenforced)"}</span></div>
            </div>
          </div>

          {d.timeline.length === 0 ? <Empty text="no security events — clean. POST /api/genesis/security/engine to scan" /> : (
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-[10px]">
                <thead><tr className="text-zinc-500 uppercase tracking-wider text-left">
                  <th className="py-1 pr-3">event</th><th className="pr-3">kind</th><th className="pr-3">sev</th><th className="pr-3">verdict</th><th className="pr-3">label</th><th>detail (redacted)</th>
                </tr></thead>
                <tbody>
                  {d.timeline.slice(0, 12).map((e) => (
                    <tr key={e.eventId} className="border-t border-rose-500/10 text-zinc-300">
                      <td className="py-1 pr-3 text-rose-300">{e.eventId}</td>
                      <td className="pr-3 text-zinc-400">{e.kind}</td>
                      <td className="pr-3"><Chip variant={sevChip(e.severity)}>{e.severity}</Chip></td>
                      <td className="pr-3"><Chip variant={verdictChip(e.verdict)}>{e.verdict}</Chip></td>
                      <td className="pr-3"><Chip variant="zinc">{e.label}</Chip></td>
                      <td className="text-zinc-400 max-w-[280px] truncate">{e.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider">every event = a real detection · evidence redacted · vulnerabilities never fabricated</div>
        </div>
      )}
    </HudPanel>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="font-mono text-[10px] text-zinc-600 py-4 text-center uppercase tracking-wider">{text}</div>;
}
