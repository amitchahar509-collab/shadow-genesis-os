"use client";

/** G11 — Plugin Marketplace panel: installable agents/tools/workflows ranked by trust.
 *  Rendered inside the Venture Intelligence tab. Trust/performance from REAL usage.
 */

import { useEffect, useState } from "react";
import { Package, RefreshCw } from "lucide-react";
import { Chip, GenesisProgress, HudPanel } from "../primitives";

interface Plugin { pluginId: string; kind: string; refKey: string; name: string; version: number; source: string; status: string; installCount: number; invocations: number; performanceScore: number; benchmarkScore: number; trustScore: number }

const kindChip = (k: string): "violet" | "cyan" | "amber" | "rose" => (k === "AGENT" ? "violet" : k === "TOOL" ? "cyan" : k === "SKILL" ? "rose" : "amber");
const sourceChip = (s: string): "emerald" | "violet" | "zinc" => (s === "BUILTIN" ? "emerald" : s === "EVOLUTION" ? "violet" : "zinc");

export function Plugins() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async (refresh = false) => {
    try { const d = await fetch(`/api/genesis/plugins?limit=12${refresh ? "&refresh=1" : ""}`).then((x) => x.json()); setPlugins(d.plugins ?? []); } catch { /* empty */ }
  };
  useEffect(() => { load(); const t = setInterval(() => load(), 20000); return () => clearInterval(t); }, []);

  const sync = async () => {
    setBusy(true);
    try { await fetch("/api/genesis/plugins", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "sync" }) }); await load(true); }
    finally { setBusy(false); }
  };

  const act = async (action: "install" | "uninstall" | "benchmark", pluginId: string) => {
    setBusy(true);
    try { await fetch("/api/genesis/plugins", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, pluginId }) }); await load(); }
    finally { setBusy(false); }
  };

  return (
    <HudPanel
      title="Plugin / Skill Marketplace"
      subtitle="installable agents · tools · workflows · skills — trust & performance from REAL usage"
      icon={<Package className="w-3.5 h-3.5" />}
      accent="violet"
      right={
        <button onClick={sync} disabled={busy} className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider px-2.5 py-1 rounded border border-violet-500/40 text-violet-300 hover:bg-violet-500/10 disabled:opacity-50">
          <RefreshCw className="w-3 h-3" /> {busy ? "syncing…" : "sync + refresh"}
        </button>
      }
    >
      {plugins.length === 0 ? <Empty text="no plugins — POST /api/genesis/plugins {action:'sync'}" /> : (
        <div className="overflow-x-auto">
          <table className="w-full font-mono text-[10px]">
            <thead>
              <tr className="text-zinc-500 uppercase tracking-wider text-left">
                <th className="py-1.5 pr-3">plugin</th><th className="pr-3">kind</th><th className="pr-3">source</th><th className="pr-3">v</th>
                <th className="pr-3">runs</th><th className="pr-3">perf</th><th className="pr-3 w-28">trust</th><th className="pr-3">installs</th><th>actions</th>
              </tr>
            </thead>
            <tbody>
              {plugins.map((p) => (
                <tr key={p.pluginId} className="border-t border-violet-500/10 text-zinc-300">
                  <td className="py-1.5 pr-3"><span className="text-violet-300">{p.pluginId}</span> <span className="text-zinc-400">{p.name}</span></td>
                  <td className="pr-3"><Chip variant={kindChip(p.kind)}>{p.kind}</Chip></td>
                  <td className="pr-3"><Chip variant={sourceChip(p.source)}>{p.source}</Chip></td>
                  <td className="pr-3">v{p.version}</td>
                  <td className="pr-3">{p.invocations}</td>
                  <td className="pr-3">{p.performanceScore}</td>
                  <td className="pr-3"><div className="flex items-center gap-1"><GenesisProgress value={p.trustScore} accent="violet" /><span className="w-6 text-right">{p.trustScore}</span></div></td>
                  <td className="pr-3">{p.status === "INSTALLED" ? <Chip variant="emerald">×{p.installCount}</Chip> : p.status === "DEPRECATED" ? <Chip variant="rose">DEPR</Chip> : p.installCount}</td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      {p.status === "INSTALLED"
                        ? <button onClick={() => act("uninstall", p.pluginId)} disabled={busy} className="px-1.5 py-0.5 rounded border border-zinc-600/40 text-zinc-400 hover:bg-zinc-500/10 disabled:opacity-50 uppercase">remove</button>
                        : p.status !== "DEPRECATED" && <button onClick={() => act("install", p.pluginId)} disabled={busy} className="px-1.5 py-0.5 rounded border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50 uppercase">install</button>}
                      <button onClick={() => act("benchmark", p.pluginId)} disabled={busy} className="px-1.5 py-0.5 rounded border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-50 uppercase">bench</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="font-mono text-[9px] text-zinc-600 uppercase tracking-wider mt-2">trust = source baseline + performance × usage-volume confidence + benchmark · unproven plugins rank low until they earn it</div>
    </HudPanel>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="font-mono text-[10px] text-zinc-600 py-4 text-center uppercase tracking-wider">{text}</div>;
}
