"use client";

/** V10 Module 8 — Economic Brain panel: real burn/runway/profit, SIMULATION forecast.
 *  Burn is always REAL (compute ledger); revenue/runway REAL or UNKNOWN; a $0-revenue
 *  loss is shown as a real loss. Nothing fabricated.
 */

import { useEffect, useState } from "react";
import { TrendingUp } from "lucide-react";
import { Chip, HudPanel } from "../primitives";

interface Metric { value: number; label: string; note?: string }
interface Overview {
  revenue: { mrr: Metric; arr: Metric; netRevenueUsd: Metric };
  burn: { computeUsd: Metric; marketingUsd: Metric; operatingUsd: Metric; monthlyBurnUsd: Metric };
  runway: { cashUsd: Metric; runwayMonths: Metric; zeroDate: string | null };
  profitability: { monthlyProfitUsd: Metric; grossMarginPct: Metric; profitable: boolean | null };
  health: { assessment: string; signals: string[] };
  hasRealRevenue: boolean;
}

const fmt = (m: Metric, prefix = "", suffix = "") => (m.label === "REAL" ? `${prefix}${m.value.toLocaleString()}${suffix}` : m.label);
const assessChip = (a: string): "rose" | "amber" | "emerald" | "zinc" =>
  a === "PROFITABLE" ? "emerald" : a === "RUNWAY_CRITICAL" || a === "REVENUE_NEGATIVE_MARGIN" ? "rose" : a === "PRE_REVENUE_BURN" ? "amber" : "zinc";

function Stat({ name, m, prefix, suffix, invertColor }: { name: string; m: Metric; prefix?: string; suffix?: string; invertColor?: boolean }) {
  const real = m.label === "REAL";
  const color = !real ? "text-zinc-500" : invertColor && m.value < 0 ? "text-rose-300" : "text-emerald-300";
  return (
    <div className="border border-emerald-500/15 rounded px-2.5 py-1.5 font-mono" title={m.note ?? ""}>
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{name}</div>
      <div className={`text-sm ${color}`}>{fmt(m, prefix, suffix)}</div>
    </div>
  );
}

export function Economics() {
  const [d, setD] = useState<Overview | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => { try { const r = await fetch("/api/genesis/economics").then((x) => x.json()); if (alive) setD(r); } catch { /* empty */ } };
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <HudPanel
      title="Economic Brain"
      subtitle="real burn · runway · profit — forecasts are SIMULATION, revenue REAL or UNKNOWN (never fabricated)"
      icon={<TrendingUp className="w-3.5 h-3.5" />}
      accent="emerald"
    >
      {!d ? <Empty text="loading…" /> : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Chip variant={assessChip(d.health.assessment)}>{d.health.assessment}</Chip>
            <span className="font-mono text-[9px] text-zinc-500">{d.health.signals.join(" · ")}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat name="MRR" m={d.revenue.mrr} prefix="$" />
            <Stat name="burn / mo" m={d.burn.monthlyBurnUsd} prefix="$" />
            <Stat name="profit / mo" m={d.profitability.monthlyProfitUsd} prefix="$" invertColor />
            <Stat name="runway" m={d.runway.runwayMonths} suffix=" mo" />
            <Stat name="compute burn" m={d.burn.computeUsd} prefix="$" />
            <Stat name="marketing" m={d.burn.marketingUsd} prefix="$" />
            <Stat name="cash" m={d.runway.cashUsd} prefix="$" />
            <Stat name="gross margin" m={d.profitability.grossMarginPct} suffix="%" />
          </div>
          <div className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider">
            burn is REAL (LLM compute + recorded costs) · {d.hasRealRevenue ? "real revenue present" : "$0 real revenue — loss shown is real"} · runway needs a recorded cash balance
          </div>
        </div>
      )}
    </HudPanel>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="font-mono text-[10px] text-zinc-600 py-4 text-center uppercase tracking-wider">{text}</div>;
}
