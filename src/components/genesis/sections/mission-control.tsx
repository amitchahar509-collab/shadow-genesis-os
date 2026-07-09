"use client";

/** G13 — Mission Control: the human-authority panel.
 *  Approval queue (approve/reject — approvals are single-use), long-horizon
 *  missions with their review trail, and the acquisition experiment memory.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, ClipboardCheck, Dna, FlaskConical, Hourglass, Radio, Repeat, ShieldAlert, X } from "lucide-react";
import { Chip, GenesisProgress, HudPanel } from "../primitives";

interface Approval { requestId: string; agent: string; actionType: string; description: string; riskScore: number; riskFactors: string[]; status: string; requestedAt: string }
interface Mission { missionId: string; goal: string; horizonDays: number; status: string; monthlyDecision: string | null; startedAt: string; endsAt: string }
interface Experiment { experimentId: string | null; subject: string | null; kind: string; status: string; dataSource: string; learning: string | null; nextAction: string | null }
interface Signal { signalId: string; kind: string; impact: string; productKey: string; source: string; generated: { kind: string; id: string }[]; payload: { detail?: string }; createdAt: string }
interface Evolution { actionId: string; agent: string; kind: string; reason: string; applied: boolean; detail: string; metrics: { successRate?: number; totalExecutions?: number }; createdAt: string }

const statusChip = (s: string): "emerald" | "amber" | "rose" | "cyan" | "zinc" =>
  s === "APPROVED" || s === "EXECUTED" || s === "LEARNED" || s === "COMPLETED" || s === "ACTIVE" ? "emerald"
  : s === "REJECTED" || s === "KILLED" || s === "EXPIRED" ? "rose"
  : s === "PENDING" || s === "AWAITING_APPROVAL" || s === "AWAITING_EXECUTION" ? "amber"
  : "zinc";

export function MissionControl() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [pending, setPending] = useState(0);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [evolutions, setEvolutions] = useState<Evolution[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [ticking, setTicking] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, m, e, f, ev] = await Promise.all([
        fetch("/api/genesis/approvals?limit=25").then((x) => x.json()),
        fetch("/api/genesis/operator?limit=10").then((x) => x.json()),
        fetch("/api/genesis/acquisition?limit=15").then((x) => x.json()),
        fetch("/api/genesis/feedback?limit=15").then((x) => x.json()),
        fetch("/api/genesis/evolution?limit=12").then((x) => x.json()),
      ]);
      setApprovals(a.requests ?? []);
      setPending(a.pending ?? 0);
      setMissions(m.missions ?? []);
      setExperiments(e.experiments ?? []);
      setSignals(f.signals ?? []);
      setEvolutions(ev.actions ?? []);
    } catch { /* panels render empty */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const decideApproval = async (requestId: string, approve: boolean) => {
    setBusy(requestId);
    try {
      await fetch("/api/genesis/approvals", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId, approve, decidedBy: "dashboard-operator" }),
      });
      await load();
    } finally { setBusy(null); }
  };

  const tickAll = async () => {
    setTicking(true);
    try {
      await fetch("/api/genesis/operator", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "tickAll" }) });
      await load();
    } finally { setTicking(false); }
  };

  return (
    <div className="space-y-4">
      {/* ===== Approval Control Center ===== */}
      <HudPanel
        title="Approval Control Center"
        subtitle="human remains CEO — external actions block here until decided"
        icon={<ShieldAlert className="w-3.5 h-3.5" />}
        accent={pending > 0 ? "rose" : "emerald"}
        right={<Chip variant={pending > 0 ? "rose" : "emerald"} dot>{pending} PENDING</Chip>}
      >
        {approvals.length === 0 ? <Empty text="no approval requests" /> : (
          <ul className="space-y-2.5">
            {approvals.map((a) => (
              <li key={a.requestId} className="font-mono text-[10px] text-zinc-300 border border-emerald-500/10 rounded-sm p-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-emerald-400">{a.requestId}</span>
                  <Chip variant="cyan">{a.actionType}</Chip>
                  <Chip variant={statusChip(a.status)}>{a.status}</Chip>
                  <span className={a.riskScore >= 70 ? "text-rose-400" : a.riskScore >= 50 ? "text-amber-400" : "text-zinc-400"}>risk {a.riskScore}</span>
                  <span className="text-zinc-500">by {a.agent}</span>
                  {a.status === "PENDING" && (
                    <span className="ml-auto flex items-center gap-1.5">
                      <button
                        onClick={() => decideApproval(a.requestId, true)}
                        disabled={busy === a.requestId}
                        className="flex items-center gap-1 px-2 py-0.5 rounded border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50 uppercase tracking-wider"
                      ><Check className="w-3 h-3" /> approve</button>
                      <button
                        onClick={() => decideApproval(a.requestId, false)}
                        disabled={busy === a.requestId}
                        className="flex items-center gap-1 px-2 py-0.5 rounded border border-rose-500/40 text-rose-400 hover:bg-rose-500/10 disabled:opacity-50 uppercase tracking-wider"
                      ><X className="w-3 h-3" /> reject</button>
                    </span>
                  )}
                </div>
                <div className="text-zinc-400 mt-1">{a.description}</div>
                {Array.isArray(a.riskFactors) && a.riskFactors.length > 0 && (
                  <div className="text-zinc-600 mt-0.5 truncate" title={a.riskFactors.join(" · ")}>{a.riskFactors.join(" · ")}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </HudPanel>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* ===== Long-horizon missions ===== */}
        <HudPanel
          title="Long-Horizon Operator"
          subtitle="30/60/90-day missions · daily/weekly/monthly loops"
          icon={<Hourglass className="w-3.5 h-3.5" />}
          accent="cyan"
          right={
            <button
              onClick={tickAll}
              disabled={ticking}
              className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider px-2.5 py-1 rounded border border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/10 disabled:opacity-50"
            ><Repeat className="w-3 h-3" /> {ticking ? "ticking…" : "tick all"}</button>
          }
        >
          {missions.length === 0 ? <Empty text="no missions yet" /> : (
            <ul className="space-y-2.5">
              {missions.map((m) => {
                const start = new Date(m.startedAt).getTime();
                const end = new Date(m.endsAt).getTime();
                const pct = Math.max(0, Math.min(100, Math.round(((Date.now() - start) / Math.max(1, end - start)) * 100)));
                return (
                  <li key={m.missionId} className="font-mono text-[10px] text-zinc-300">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-cyan-300">{m.missionId}</span>
                      <span className="flex-1 truncate" title={m.goal}>{m.goal}</span>
                      <Chip variant="cyan">{m.horizonDays}d</Chip>
                      {m.monthlyDecision && <Chip variant={m.monthlyDecision === "KILL" ? "rose" : "violet"}>{m.monthlyDecision}</Chip>}
                      <Chip variant={statusChip(m.status)}>{m.status}</Chip>
                    </div>
                    <GenesisProgress value={m.status === "COMPLETED" ? 100 : pct} accent="cyan" />
                  </li>
                );
              })}
            </ul>
          )}
        </HudPanel>

        {/* ===== Acquisition experiment memory ===== */}
        <HudPanel
          title="Acquisition Experiments"
          subtitle="hypothesis → experiment → learn · measurements labelled SIMULATION until real telemetry"
          icon={<FlaskConical className="w-3.5 h-3.5" />}
          accent="violet"
        >
          {experiments.length === 0 ? <Empty text="no experiments yet" /> : (
            <ul className="space-y-2.5">
              {experiments.map((e) => (
                <li key={e.experimentId ?? Math.random()} className="font-mono text-[10px] text-zinc-300">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-violet-300">{e.experimentId}</span>
                    <Chip variant="violet">{e.kind}</Chip>
                    <Chip variant={statusChip(e.status)}>{e.status}</Chip>
                    <Chip variant={e.dataSource === "SIMULATION" ? "amber" : e.dataSource === "REAL" ? "emerald" : "zinc"}>{e.dataSource}</Chip>
                    <span className="text-zinc-500 truncate">{e.subject}</span>
                  </div>
                  {e.learning && <div className="text-zinc-400 mt-0.5 line-clamp-2" title={e.learning}>{e.learning}</div>}
                  {!e.learning && e.nextAction && <div className="text-zinc-600 mt-0.5">next: {e.nextAction}</div>}
                </li>
              ))}
            </ul>
          )}
        </HudPanel>
      </div>

      {/* ===== Reality Feedback Brain ===== */}
      <HudPanel
        title="Reality Feedback"
        subtitle="deployed products report REAL telemetry → tasks · metrics · closed experiments"
        icon={<Radio className="w-3.5 h-3.5" />}
        accent="emerald"
      >
        {signals.length === 0 ? <Empty text="no product signals yet — deployed apps POST to /api/genesis/feedback" /> : (
          <ul className="space-y-2">
            {signals.map((s) => (
              <li key={s.signalId} className="font-mono text-[10px] text-zinc-300 flex items-center gap-2 flex-wrap">
                <span className="text-emerald-400">{s.signalId}</span>
                <Chip variant="emerald">REAL</Chip>
                <Chip variant={s.impact === "NEGATIVE" ? "rose" : s.impact === "POSITIVE" ? "emerald" : "zinc"}>{s.kind}</Chip>
                <span className="text-zinc-500">{s.productKey}</span>
                <span className="flex-1 truncate" title={s.payload?.detail}>{s.payload?.detail}</span>
                {s.generated?.length > 0 && <span className="text-cyan-400 shrink-0">→ {s.generated.map((g) => `${g.kind} ${g.id}`).join(", ")}</span>}
              </li>
            ))}
          </ul>
        )}
      </HudPanel>

      {/* ===== Agent Evolution ===== */}
      <HudPanel
        title="Agent Evolution"
        subtitle="agents improve from real performance → prompt guards · rollbacks · specialist proposals"
        icon={<Dna className="w-3.5 h-3.5" />}
        accent="violet"
      >
        {evolutions.length === 0 ? <Empty text="no evolution actions yet — PATCH /api/genesis/evolution {action:'evolveAll'}" /> : (
          <ul className="space-y-2">
            {evolutions.map((e) => (
              <li key={e.actionId} className="font-mono text-[10px] text-zinc-300 flex items-center gap-2 flex-wrap">
                <span className="text-violet-300">{e.actionId}</span>
                <Chip variant={e.kind === "RETIRE_WORKFLOW" ? "rose" : e.kind === "NO_ACTION" ? "zinc" : "violet"}>{e.kind}</Chip>
                {e.applied && <Chip variant="emerald">applied</Chip>}
                <span className="text-zinc-500">{e.agent}</span>
                {typeof e.metrics?.successRate === "number" && <span className="text-zinc-600">{Math.round(e.metrics.successRate * 100)}%/{e.metrics.totalExecutions}</span>}
                <span className="flex-1 truncate" title={e.reason}>{e.reason}</span>
                {e.detail && <span className="text-cyan-400 shrink-0 truncate max-w-[180px]" title={e.detail}>{e.detail}</span>}
              </li>
            ))}
          </ul>
        )}
      </HudPanel>

      <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-wider text-zinc-600">
        <ClipboardCheck className="w-3 h-3" /> approvals are single-use · rejected actions never run · REAL = external product telemetry (never fabricated) · auto-refreshes every 15s
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="font-mono text-[10px] text-zinc-600 py-4 text-center uppercase tracking-wider">{text}</div>;
}
