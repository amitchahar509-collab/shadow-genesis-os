"use client";

/** Genesis Settings (V10.1 app layer) — configure AI providers, deployment, action
 *  connectors, revenue, and enterprise options from the UI. Secret values are shown
 *  masked and never returned raw; saving takes effect immediately. */

import { useEffect, useState, useCallback } from "react";

interface KeyRow { key: string; label: string; secret: boolean; hint: string; configured: boolean; masked: string | null }
interface Group { group: string; keys: KeyRow[] }
interface Data { config: Group[]; live: { llm: string[] } }

export default function Settings() {
  const [data, setData] = useState<Data | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => { try { setData(await fetch("/api/genesis/settings").then((r) => r.json())); } catch { setMsg("could not reach the server"); } }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const entries = Object.fromEntries(Object.entries(edits).filter(([, v]) => v !== undefined));
    if (Object.keys(entries).length === 0) { setMsg("nothing to save"); return; }
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/genesis/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entries }) }).then((x) => x.json());
      if (r.error) setMsg(`error: ${r.error}`);
      else { setMsg(`saved ${r.applied?.length ?? 0} key(s) — in effect now`); setEdits({}); await load(); }
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="font-mono text-lg text-emerald-400">Genesis Settings</h1>
            <p className="text-zinc-500 text-xs mt-0.5">Keys are stored locally (git-ignored), never returned raw, and take effect immediately.</p>
          </div>
          <a href="/" className="font-mono text-xs text-zinc-400 hover:text-zinc-200">← Dashboard</a>
        </div>

        {data && data.live.llm.length === 0 && (
          <div className="mb-4 rounded-lg border border-amber-600/40 bg-amber-900/10 px-3 py-2 font-mono text-xs text-amber-300">No AI provider configured — agents fall back to rule-based logic. Add a key below (Gemini is free).</div>
        )}

        {!data ? <div className="font-mono text-sm text-zinc-500">loading…</div> : data.config.map((g) => (
          <div key={g.group} className="mb-5">
            <h2 className="font-mono text-sm text-zinc-300 uppercase tracking-wider mb-2">{g.group}</h2>
            <div className="space-y-2">
              {g.keys.map((k) => (
                <div key={k.key} className="grid grid-cols-[1fr_2fr] items-center gap-3 border border-zinc-800 rounded-lg px-3 py-2 bg-zinc-900/40">
                  <div>
                    <div className="font-mono text-sm text-zinc-200 flex items-center gap-2">
                      {k.label}
                      <span className={`text-[9px] px-1 rounded ${k.configured ? "bg-emerald-900 text-emerald-300" : "bg-zinc-800 text-zinc-500"}`}>{k.configured ? "SET" : "unset"}</span>
                    </div>
                    <div className="font-mono text-[10px] text-zinc-500">{k.hint}</div>
                  </div>
                  <input
                    type={k.secret ? "password" : "text"}
                    value={edits[k.key] ?? ""}
                    onChange={(e) => setEdits({ ...edits, [k.key]: e.target.value })}
                    placeholder={k.configured ? (k.masked ?? "configured") : "not set — paste to configure"}
                    className="px-3 py-1.5 rounded bg-zinc-800 border border-zinc-700 font-mono text-xs text-zinc-100 focus:border-emerald-600 outline-none"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="flex items-center gap-3 sticky bottom-4 mt-4">
          <button onClick={save} disabled={busy} className="px-5 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-black font-mono text-sm disabled:opacity-50">{busy ? "saving…" : "Save changes"}</button>
          {msg && <span className="font-mono text-xs text-zinc-400">{msg}</span>}
        </div>
        <p className="font-mono text-[10px] text-zinc-600 mt-4">Leaving a field blank keeps the current value. To clear a key, you can remove it from .genesis-config.json. Enterprise auth/backup/encryption stay UNCONFIGURED until set here.</p>
      </div>
    </div>
  );
}
