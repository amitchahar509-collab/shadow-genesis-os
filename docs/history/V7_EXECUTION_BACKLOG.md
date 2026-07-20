# V7_EXECUTION_BACKLOG — Shadow Genesis OS

> Ranked by impact. Each item: owner agent, dependencies, implementation plan, success test. Created 2026-07-08 (V7 loop, Phase 0). Reuse existing modules — never duplicate.

| # | Task (V7 phase) | Impact | Owner | Depends | Plan | Success test |
|---|-----------------|--------|-------|---------|------|--------------|
| V1 | ~~**Digital Customer Simulation** (P2)~~ — ✅ DELIVERED cycle 7. N virtual customers → CUSTOMER_REALITY_SCORE; SIMULATION-typed AEGIS claim; feeds the board's Customer seat. | 9 | CUSTOMER | AEGIS ✓ | ✅ CustomerSimulation+CustomerPersona models; CUSTOMER agent; API + artifact | ✅ 6 tests + e2e: strong 79% buy/reality 81→Customer GO; weak 17%/46→ABSTAIN |
| V2 | **Wire VENTURE→AEGIS→CUSTOMER→BOARD into the CEO plan** (final pipeline) — decomposition inserts these before ENGINEERING. | 8 | CEO | V1 | Extend rule-based + LLM plan; add gate tasks | Dispatch mission; assert task order + gate artifacts |
| V3 | **Demand Intelligence Network / Product DNA** (P3) — problem↔user↔industry graph; DEMAND_MATCH_SCORE. | 7 | GROWTH | V1 | ProductDNA + DemandMatch models; match agent | Built product → ranked demand matches |
| V4 | **Human Approval Control Center** (P7) — queue gating emails/posts/payments/purchases/contact. | 8 | SECURITY | — | ApprovalRequest model; enqueue/approve/reject API; block external tools pending approval | External action blocked until approved |
| V5 | **Autonomous Acquisition Engine** (P5) — experiment loop over GrowthExperiment; experiment memory. | 7 | GROWTH | V3, V4 | Hypothesis→action→measure→learn cycle; outcomes persisted | Experiment recorded w/ outcome + learning |
| V6 | **Long-Horizon Operator** (P6) — 30/60/90-day missions; daily/weekly/monthly loops. | 7 | CEO | V2 | LongMission + scheduled reviews | 30-day mission w/ scheduled reviews |
| V7 | **Production SaaS foundation** (P10) — auth, orgs, roles, usage limits. | 8 | SECURITY | — | NextAuth + User/Org/Role; guard routes | Unauthenticated call → 401 |
| V8 | **Agent Competition Arena** (P8) — Alpha/Beta/Gamma teams; Judge agent. | 6 | CEO | V2 | Parallel team runs; judge scores; pick winner | 3 teams → 1 winner recorded |
| V9 | **Reality Feedback Brain** (P11) — deployed product signals → improvement tasks. | 6 | DEPLOYMENT | V5 | Telemetry ingest → tasks | Signal in → improvement task out |
| V10 | **Benchmark Arena** (P13) — autonomy/quality/time/cost scoring over task suites. | 6 | QUALITY | — | BenchmarkRun model; scored suites | Two runs → 2 scored rows |
| V11 | **Exercise LLM path + DEGRADED badge** — real reasoning with a key; UI provider status. | 9 | CEO | — | Wire status to UI | With key: real args; without: DEGRADED |
| V12 | **Dashboard UI** for boardroom/venture/aegis/customer (P-cross) — new intelligence is API-only. | 6 | DESIGN | V1 | Sections read live APIs | Panels render real rows |

## Cycle 7 — DELIVERED: V1 (Digital Customer Simulation)

- **CustomerSimulation + CustomerPersona** models; **CUSTOMER** agent (`agents/v7-customer.ts`). Procedurally generates N (default 200, ≤2000) seeded, reproducible personas → BUY/MAYBE/NO_BUY with willingness-to-pay, objections, triggers, missing features → **CUSTOMER_REALITY_SCORE**. Persists an aggregate + a 24-persona sample; artifact `CUSTOMER_REALITY.md`.
- **Honesty**: labelled SIMULATION everywhere; the AEGIS claim it asserts is SIMULATION-typed at weight 0.3 with declared unknowns ("procedurally generated, not real customers") — a simulated buy-rate can never become real market evidence.
- **Connected**: AEGIS (demand claim) + Boardroom (Customer Representative seat reads the reality score). E2E: strong-fit 79% buy / reality 81 → Customer GO → BOARD GO; weak-fit 17% / reality 46 → Customer ABSTAIN → BOARD NO_GO 79%.
- API `/api/genesis/customers`. Registered CUSTOMER in registry, collab, permissions. Verified: tsc ✓, eslint ✓, 65/65 tests (6 new), build compiles route.

## Self-improvement re-audit (next, ranked)

The final pipeline now has every reality gate except automatic wiring: **V2** (insert VENTURE→AEGIS→CUSTOMER→BOARD into the CEO plan) is the highest-leverage next step — it makes the whole chain run on a single "create a company" prompt, the stated completion condition. Then **V4** (Approval Control Center — safety before any external action), **V11** (exercise the LLM path), **V7** (auth). V2 is the recommended cycle-8 target.
