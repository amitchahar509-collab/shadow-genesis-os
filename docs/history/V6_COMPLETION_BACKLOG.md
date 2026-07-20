# V6_COMPLETION_BACKLOG — Shadow Genesis OS

> Ranked by measured impact. Every task has an owner agent, dependencies, success criteria, and a verification method. Created 2026-07-08 (AEGIS + Market Reality loop, Phase 0). Never duplicate existing systems — check the audit inventory first.

| # | Task | Impact | Owner | Depends on | Success criteria | Verification |
|---|------|--------|-------|-----------|------------------|--------------|
| A1 | ~~**AEGIS Truth Engine** (V6 Phase 1)~~ — ✅ DELIVERED cycle 6. `Claim`+`Evidence` ledger; truth score refuses confidence without evidence; connected to Venture + Boardroom. | 9 | RESEARCH | — | ~~0-evidence claim → UNSUPPORTED; venture forwards truthScore to board~~ ✅ | ✅ 6 tests + e2e |
| A2 | ~~**Venture ⇄ AEGIS integration**~~ — ✅ DELIVERED cycle 6. VENTURE asserts the market claim from the opportunity's real (WEB) evidence; computed signals recorded NEUTRAL; UNSUPPORTED truth caps INVEST→WATCH; board confidence + evidence signal capped by truth. | 8 | VENTURE | A1 | ~~0-evidence opportunity cannot produce a clean INVEST; artifact shows TRUTH line~~ ✅ | ✅ e2e: capped |
| A3 | **Digital Customer Simulation** (V6 Phase 2) — ≥100 personas/opportunity (expandable); CUSTOMER_REALITY_SCORE; gate builds. | 8 | CUSTOMER | A1 | Sim produces buy/no-buy distribution + objections + price; persisted | Run sim; assert persona rows + report artifact |
| A4 | **Wire VENTURE→AEGIS→BOARD into the CEO plan** — decomposition inserts evidence-check + venture + board gate before ENGINEERING. | 7 | CEO | A1, A2 | Rule-based & LLM plans place these ahead of build | Dispatch mission; assert task order |
| A5 | **Dashboard UI panels** (V6 Phase 7) — sections for Truth Engine, Venture, Boardroom (read the new APIs). | 6 | DESIGN | A1 | Dashboard shows claims/verdicts/venture scores from live APIs | Load dashboard; panels render real rows |
| A6 | **Demand Graph + Customer Match** (V6 Phase 3) — Product DNA ↔ user matching; need/adoption/fit ranks. | 6 | GROWTH | A3 | Built app gets Product DNA + ranked matches | Match run; assert ranked matches |
| A7 | **Autonomous Acquisition loop** (V6 Phase 4) — experiment hypothesis→measure→learn over `GrowthExperiment`; experiment memory. External actions gated by approval. | 6 | GROWTH | A6, Approval Queue | Experiments recorded with outcome + learning; external actions blocked pending approval | Run loop; assert experiment + learning rows |
| A8 | **Long-Horizon Operator** (V6 Phase 5) — 30/60/90-day missions; daily/weekly/monthly loops. | 6 | CEO | A4 | A mission spans days with scheduled reviews | Create 30-day mission; assert scheduled reviews |
| A9 | **Approval Queue** (V6 Phase 4 safety) — payments/emails/posting gated; human is final authority. | 7 | SECURITY | — | External actions enqueue + block until approved | Enqueue action; assert blocked until approved |
| A10 | **Exercise LLM path + DEGRADED badge** — with a real key, boardroom/venture/aegis produce real reasoning; UI shows provider status. | 9 | CEO | — | With key: real args; without: visible DEGRADED | Run with key; UI shows status |
| A11 | **Auth on all routes** — every `/api/genesis/*` is open. | 8 | SECURITY | — | Unauthenticated calls → 401 | Integration test without session |

## Cycle 6 — DELIVERED: A1 + A2 (AEGIS Truth Engine + Venture integration)

- **AEGIS** (`agent-runtime/aegis/`): `Claim` + `Evidence` models; `scoreEvidence`/`assertClaim`/`verifySubject`/`contradictions`. Invariant enforced & tested: **no evidence ⇒ truthScore 0 ⇒ UNSUPPORTED**; volume damping stops a single weak source reaching high confidence; contradictions force CONTESTED. `/api/genesis/aegis` (assert / list / verify).
- **Venture ⇄ AEGIS**: VENTURE asserts "market demand supports a venture-scale outcome" from the opportunity's real WEB sources (computed signals logged NEUTRAL, never as support). UNSUPPORTED truth caps INVEST→WATCH and writes a TRUTH line into VENTURE_SCORE.md; truthScore flows to the board.
- **Boardroom**: an AEGIS truth score caps board confidence (0 truth → ≤40) and drives the evidence signal, so Risk/Customer seats react to weak grounding. E2E: 4-source venture → truth 55% CONTESTED → INVEST capped to WATCH → BOARD GO 70%; 0-source → truth 0% UNSUPPORTED → WATCH → BOARD splits 5/2/2 @63%.
- Verified: tsc ✓, eslint ✓, 59/59 tests (6 new), `next build` compiles `/api/genesis/aegis`.

## Self-improvement re-audit (next tasks, ranked)

Highest remaining autonomy blockers, in order: **A3** Digital Customer Simulation (the next "reality" layer — turns predicted demand into simulated buyers) → **A4** wire VENTURE→AEGIS→BOARD into the CEO plan → **A5** dashboard UI (the new intelligence is API-only) → **A10** exercise the LLM path → **A11** auth. A3 is the recommended cycle-7 target.
