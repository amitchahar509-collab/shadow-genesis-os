# MODEL_ROUTER_AUDIT — V9 Multi-Brain Router (Phase 0)

> Measured 2026-07-10. Live OpenRouter key configured (346+ models visible); Anthropic direct adapter present but key empty. 173/173 tests green at `fc29e9b`.

## CURRENT (verified by execution)

- **Adapters** (`types.ts`): `callAnthropic` (direct), `callOpenRouter` (OpenAI-compatible, live-proven: real completions), `callZai` (legacy). Raw token splits returned. `callLlm` legacy path preserved.
- **Router** (`router/`): static capability map (agent → REASONING/CODING/LONG_CONTEXT/CHEAP/DEFAULT), hardcoded `CHAINS` with verified OpenRouter-primary slugs, provider-filtered; `callLlmRouted` walks the chain once each, records `LlmUsage` (real tokens + estimated cost + fallbackDepth). Live-proven: CEO→claude-opus-4.8, RESEARCH→gemini-3.5-flash, MEMORY→gpt-4o-mini @depth 0; real fallback to gemini-3.1-flash-lite/qwen-coder @depth 1.
- **Boardroom**: all nine seats call `callLlmRouted(agent="BOARDROOM")` → one REASONING chain for every seat (single-brain debate).
- **Arena (G6)**: 3 *strategy teams*, one reasoning substrate — competition of strategies, not models.
- **Benchmark (G12)**: intelligence/full suites measure gate discrimination; no model-vs-model measurement.
- **Evolution (G7)**: improves prompts/workflows per agent; blind to which model ran.
- **Cost tracking**: `LlmUsage` per call (agent, capability, provider, model, tokens, est. cost, fallbackDepth); `usageSummary` by provider/model/agent; dashboard shows totals.
- **Registry (partial, uncommitted)**: `ModelRegistry` prisma model sketched (slug/family/prices/context/reasoningTier/codingTier) — no module, no data, no wiring.

## MISSING (V9 gaps)

1. **Dynamic model registry** — chains are hardcoded constants; models not replaceable at runtime; no latency/reliability/research scores; no sync from the live catalog.
2. **Multi-model boardroom** — every seat uses the same chain; the directive wants per-seat brains (Founder→GPT, Investor→Opus, Engineer→coder, Research→Gemini, Risk→Claude/GPT) genuinely debating.
3. **Model Arena** — no same-task, many-models, judged competition; no stored duel results.
4. **Auto model selection** — routing ignores measured history (`LlmUsage` success/latency/cost is recorded but never read back into routing).
5. **Cost intelligence** — no pre-call expected-cost estimate; no importance level (cheap task → cheap model, critical → frontier).
6. **Fallback 2.0** — single pass over the chain; no retry of a transiently-failed model; no explicit emergency-cheap terminal hop guarantee.
7. **Model Command Center** — dashboard shows usage totals but no registry, leaderboard, per-model failures, or routing view.
8. **Benchmark ↔ router** — no "models" suite; rankings never update assignments; weekly cadence needs the external-scheduler pattern (same as operator ticks — honest, no hidden daemon).

## WEAK

- Price table is a hardcoded map (should live in the registry, seeded from OpenRouter's real per-model pricing).
- `GENESIS_LLM_MODEL` only affects the legacy path — fine, but must be documented as such.
- Reliability is unmeasured: a model that intermittently 429s looks identical to a healthy one until it fails a call.

## OPTIMIZATION PLAN (this cycle)

1. **Registry engine** (`model-registry/`): extend the sketched `ModelRegistry` (add researchTier, reliability, avgLatencyMs, strengths/weaknesses); seed curated frontier profiles (Claude Opus/Sonnet latest, GPT reasoning, Gemini Pro/Flash, GLM, Qwen Coder, DeepSeek, minis) and **sync availability + real prices from OpenRouter's live catalog**; scores updatable (never hardcoded forever).
2. **Router v2**: chains built from the registry per capability; blend curated tier with **measured** success rate + latency from `LlmUsage` (auto selection, "no fixed opinions"); `importance: "LOW"|"NORMAL"|"CRITICAL"` picks cheap/standard/frontier; pre-call expected-cost estimate recorded; Fallback 2.0 = retry once → same-provider next → cross-provider → emergency cheap.
3. **Multi-model boardroom**: per-seat model preferences resolved through the registry; artifact records which brain argued each seat.
4. **Model Arena** (`model-arena/`): same prompt → N models → judge (accuracy vs expected answer where checkable + speed + cost) → `ModelDuel` rows; feeds reliability/measured scores.
5. **Benchmark integration**: `suite: "models"` runs a standard duel set and updates registry `measured*` fields + rankings (weekly via external cron hitting the endpoint).
6. **Dashboard**: Model Command Center panel (active models, leaderboard, per-agent routing, cost/tokens, failures).
7. Tests network-free via injectable invoke; live final test with the real key ("create a new company opportunity" — verify Gemini/Opus/coder/cheap routing + fallback + cost + learning).
