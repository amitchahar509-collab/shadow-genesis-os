"use client";

/** Genesis Setup Wizard (V10.1 app layer) — a 6-step guided setup driven entirely
 *  by real backend detection. No terminal, no code. Welcome → Check Environment →
 *  Configure Database → Configure AI Providers → Verify → Launch. */

import { useEffect, useState, useCallback } from "react";

interface Check { id: string; label: string; status: "ok" | "warn" | "fail"; detail: string; repair?: string }
interface Readiness {
  ready: boolean; runtime: Check; database: Check; llm: Check; docker: Check;
  providers: { llm: string[]; action: number; cloud: number; revenue: number };
  summary: { ok: number; warn: number; fail: number };
}

const STEPS = ["Welcome", "Environment", "Database", "AI Providers", "Verify", "Launch"];
const dot = (s: string) => (s === "ok" ? "🟢" : s === "warn" ? "🟡" : "🔴");

export default function SetupWizard() {
  const [step, setStep] = useState(0);
  const [rd, setRd] = useState<Readiness | null>(null);
  const [busy, setBusy] = useState(false);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    try { setRd(await fetch("/api/genesis/setup").then((r) => r.json())); } catch { setMsg("could not reach the server"); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const initDb = async () => {
    setBusy(true); setMsg("");
    try { const r = await fetch("/api/genesis/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "init-db" }) }).then((x) => x.json()); setMsg(r.ok ? "Database initialized ✓" : `Init failed: ${r.detail ?? r.error}`); await refresh(); }
    finally { setBusy(false); }
  };
  const saveKeys = async () => {
    const entries = Object.fromEntries(Object.entries(keys).filter(([, v]) => v.trim() !== ""));
    if (Object.keys(entries).length === 0) { setStep(4); return; }
    setBusy(true); setMsg("");
    try { await fetch("/api/genesis/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entries }) }); setMsg("Provider keys saved ✓"); await refresh(); setStep(4); }
    finally { setBusy(false); }
  };

  const Row = ({ c }: { c: Check }) => (
    <div className="flex items-start gap-3 py-2 border-b border-zinc-800">
      <span className="text-lg leading-none">{dot(c.status)}</span>
      <div className="flex-1">
        <div className="font-mono text-sm text-zinc-200">{c.label} <span className="text-zinc-500">— {c.detail}</span></div>
        {c.repair && c.status !== "ok" && <div className="font-mono text-xs text-amber-400/80 mt-0.5">↳ {c.repair}</div>}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        {/* stepper */}
        <div className="flex items-center justify-between mb-6">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center font-mono text-xs ${i === step ? "bg-emerald-500 text-black" : i < step ? "bg-emerald-900 text-emerald-300" : "bg-zinc-800 text-zinc-500"}`}>{i < step ? "✓" : i + 1}</div>
              {i < STEPS.length - 1 && <div className={`w-6 h-px ${i < step ? "bg-emerald-700" : "bg-zinc-800"}`} />}
            </div>
          ))}
        </div>

        <div className="border border-zinc-800 rounded-xl bg-zinc-900/50 p-6 min-h-[320px]">
          <h1 className="font-mono text-lg text-emerald-400 mb-1">Genesis Setup — {STEPS[step]}</h1>

          {step === 0 && (
            <div className="space-y-4">
              <p className="text-zinc-300 text-sm leading-relaxed mt-3">Welcome to <b>Shadow Genesis OS</b> — an autonomous AI company operating system. This wizard checks your environment, initializes the database, and configures AI providers. No terminal required.</p>
              <p className="text-zinc-500 text-xs">Only a database is required to run. AI provider keys are optional (Gemini has a free tier); connectors can be added later in Settings.</p>
            </div>
          )}

          {step === 1 && rd && (
            <div className="mt-3">
              <Row c={rd.runtime} /><Row c={rd.database} /><Row c={rd.llm} /><Row c={rd.docker} />
              <div className="font-mono text-xs text-zinc-500 mt-3">{rd.summary.ok} ok · {rd.summary.warn} warnings · {rd.summary.fail} blocking</div>
            </div>
          )}

          {step === 2 && rd && (
            <div className="mt-3 space-y-3">
              <Row c={rd.database} />
              {rd.database.status !== "ok"
                ? <button onClick={initDb} disabled={busy} className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-black font-mono text-sm disabled:opacity-50">{busy ? "initializing…" : "Initialize database"}</button>
                : <p className="text-emerald-400 font-mono text-sm">Database is ready — no action needed.</p>}
            </div>
          )}

          {step === 3 && (
            <div className="mt-3 space-y-3">
              <p className="text-zinc-400 text-xs">Add at least one AI provider (optional). <b>Gemini</b> has a free tier that works without a card. Keys are stored locally and never leave your machine.</p>
              {[["GEMINI_API_KEY", "Google Gemini (free tier)"], ["OPENROUTER_API_KEY", "OpenRouter"], ["ANTHROPIC_API_KEY", "Anthropic (Claude)"], ["OPENAI_API_KEY", "OpenAI"]].map(([k, label]) => (
                <div key={k}>
                  <label className="font-mono text-xs text-zinc-400">{label}</label>
                  <input type="password" value={keys[k] ?? ""} onChange={(e) => setKeys({ ...keys, [k]: e.target.value })} placeholder="paste key (leave blank to skip)" className="w-full mt-1 px-3 py-2 rounded bg-zinc-800 border border-zinc-700 font-mono text-sm text-zinc-100 focus:border-emerald-600 outline-none" />
                </div>
              ))}
            </div>
          )}

          {step === 4 && rd && (
            <div className="mt-3">
              <Row c={rd.runtime} /><Row c={rd.database} /><Row c={rd.llm} />
              <div className="font-mono text-xs text-zinc-500 mt-3">connectors ready — action: {rd.providers.action} · cloud: {rd.providers.cloud} · revenue: {rd.providers.revenue}</div>
              <div className={`mt-3 font-mono text-sm ${rd.ready ? "text-emerald-400" : "text-rose-400"}`}>{rd.ready ? "✓ Genesis is ready to launch" : "✗ Database not ready — go back to step 3"}</div>
            </div>
          )}

          {step === 5 && (
            <div className="mt-3 space-y-4 text-center">
              <div className="text-5xl">🚀</div>
              <p className="text-zinc-300">Setup complete. Genesis is ready.</p>
              <a href="/" className="inline-block px-6 py-3 rounded bg-emerald-500 hover:bg-emerald-400 text-black font-mono">Launch Genesis →</a>
              <p className="text-zinc-600 text-xs">You can change providers and connectors any time in <a href="/settings" className="text-emerald-400 underline">Settings</a>.</p>
            </div>
          )}

          {msg && <div className="mt-4 font-mono text-xs text-zinc-400">{msg}</div>}
        </div>

        {/* nav */}
        <div className="flex items-center justify-between mt-4">
          <button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0} className="px-4 py-2 font-mono text-sm text-zinc-400 hover:text-zinc-200 disabled:opacity-30">← Back</button>
          {step < 5 && (
            <button onClick={() => { if (step === 3) saveKeys(); else setStep(step + 1); }} disabled={busy} className="px-5 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-black font-mono text-sm disabled:opacity-50">{step === 3 ? "Save & continue" : "Continue →"}</button>
          )}
        </div>
      </div>
    </div>
  );
}
