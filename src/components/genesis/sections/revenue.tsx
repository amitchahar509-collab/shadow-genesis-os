"use client";

/** V10 Module 3 — Revenue panel: REAL unit economics or an honest $0/UNKNOWN.
 *  Nothing here is ever fabricated — figures show REAL only when real payment
 *  data exists; otherwise they read UNKNOWN by design.
 */

import { useEffect, useState } from "react";
import { DollarSign } from "lucide-react";
import { Chip, HudPanel } from "../primitives";

interface Metric { value: number; label: string; note?: string }
interface Overview {
  economics: {
    currency: string; mrr: Metric; arr: Metric; arpu: Metric; activeSubscribers: number;
    churnRatePct: Metric; ltv: Metric; cac: Metric; ltvCacRatio: Metric;
    grossRevenueUsd: Metric; netRevenueUsd: Metric; hasRealRevenue: boolean;
  };
  providers: { name: string; available: boolean; note: string }[];
  byProvider: { provider: string; count: number; usd: number }[];
  honesty: string;
}

const fmt = (m: Metric, prefix = "") => (m.label === "REAL" ? `${prefix}${m.value.toLocaleString()}` : m.label);
const labelChip = (l: string): "emerald" | "zinc" | "amber" => (l === "REAL" ? "emerald" : l === "SIMULATION" ? "amber" : "zinc");

function Stat({ name, m, prefix }: { name: string; m: Metric; prefix?: string }) {
  return (
    <div className="font-mono border border-emerald-500/15 rounded px-2.5 py-1.5" title={m.note ?? ""}>
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{name}</div>
      <div className="flex items-center gap-1.5">
        <span className={`text-sm ${m.label === "REAL" ? "text-emerald-300" : "text-zinc-500"}`}>{fmt(m, prefix)}</span>
        {m.label !== "REAL" && <Chip variant={labelChip(m.label)}>{m.label}</Chip>}
      </div>
    </div>
  );
}

export function Revenue() {
  const [d, setD] = useState<Overview | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => { try { const r = await fetch("/api/genesis/revenue?overview=1").then((x) => x.json()); if (alive) setD(r); } catch { /* empty */ } };
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <HudPanel
      title="Revenue Execution"
      subtitle="real unit economics — figures are REAL only with real payment data, else UNKNOWN (never fabricated)"
      icon={<DollarSign className="w-3.5 h-3.5" />}
      accent="emerald"
    >
      {!d ? <Empty text="loading…" /> : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat name="MRR" m={d.economics.mrr} prefix="$" />
            <Stat name="ARR" m={d.economics.arr} prefix="$" />
            <Stat name="ARPU" m={d.economics.arpu} prefix="$" />
            <Stat name="Active subs" m={{ value: d.economics.activeSubscribers, label: "REAL" }} />
            <Stat name="Churn %" m={d.economics.churnRatePct} />
            <Stat name="LTV" m={d.economics.ltv} prefix="$" />
            <Stat name="CAC" m={d.economics.cac} prefix="$" />
            <Stat name="LTV:CAC" m={d.economics.ltvCacRatio} />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {d.providers.map((p) => (
              <span key={p.name} title={p.note} className={`font-mono text-[9px] px-1.5 py-0.5 rounded border ${p.available ? "border-emerald-500/30 text-emerald-300" : "border-zinc-700 text-zinc-600"}`}>{p.name}:{p.available ? "connected" : "no key"}</span>
            ))}
          </div>
          {d.byProvider.length > 0 && (
            <div className="font-mono text-[9px] text-zinc-500">by provider: {d.byProvider.map((b) => `${b.provider} $${b.usd} (${b.count})`).join(" · ")}</div>
          )}
          <div className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider">{d.honesty}</div>
        </div>
      )}
    </HudPanel>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="font-mono text-[10px] text-zinc-600 py-4 text-center uppercase tracking-wider">{text}</div>;
}
