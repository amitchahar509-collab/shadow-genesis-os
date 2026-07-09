# V8_COMPLETION_QUEUE — Shadow Genesis OS

> Ranked by impact. Created 2026-07-09 (V8 loop, Phase 0). Extend existing systems — never rebuild, never duplicate.

| # | Gap (V8) | Impact | Depends | Implementation plan | Test method | Completion proof |
|---|----------|--------|---------|---------------------|-------------|------------------|
| G0 | ~~**Integrated autonomous pipeline**~~ — ✅ DELIVERED cycle 8. `createCompany()` chains DISCOVER→AEGIS→VENTURE→CUSTOMER→BOARD→BUILD gate; `VentureRun` record; reuses `Company`. | 10 | all gates ✓ | ✅ `pipeline/company.ts`; `/api/genesis/company` | ✅ 5 tests: NO_GO halts, strong passes, honesty labels, autonomous discovery, honest failure | ✅ Acceptance run RUN-000011: no idea → discovered → gates scored → board CONDITIONAL 59% → **7/7 BUILT** → company + VENTURE_RUN.md |
| G1 | **World Scanner upgrade** (Gap 1) — add frequency/urgency/who-suffers to OPPORTUNITY output → WORLD_PROBLEM_GRAPH. | 7 | G0 | extend OPPORTUNITY prompt+fallback+model fields | scan → graph has urgency/sufferers | graph artifact fields populated |
| G2 | **Approval Control Center** (Gap 8) — queue gating external actions; risk scoring; logs. | 8 | — | ApprovalRequest model + API + tool-layer hook | external action blocks until approved | blocked call → approve → proceeds |
| G3 | **Demand Graph + Customer Match** (Gap 2) — problem↔user↔industry↔product mapping; DEMAND_MATCH_SCORE. | 7 | G0 | ProductDNA/DemandMatch models + MATCH agent | product → ranked matches | match rows + artifact |
| G4 | **Acquisition loop** (Gap 4) — hypothesis→experiment→measure→learn over GrowthExperiment; experiment memory. | 7 | G3, G2 | ACQUISITION agent + loop runner | experiment rows w/ learning | loop advances state machine |
| G5 | **Long-Horizon Operator** (Gap 5) — 30/60/90-day missions, daily/weekly/monthly reviews. | 7 | G0 | LongMission model + operator loop | mission with scheduled reviews | review rows over time |
| G6 | **Agent Arena** (Gap 6) — Alpha/Beta/Gamma parallel solutions; judge picks winner. | 6 | G0 | arena runner over existing agents + judge | 3 runs → 1 winner | ArenaRun row + verdict |
| G7 | **Agent Evolution completion** (Gap 7) — auto-retire/create from AgentMetric trends. | 6 | — | extend improvement/analyzer | weak workflow retired | evolution log row |
| G8 | **App Marketplace** (Gap 3) — Product DNA registry + demand matching for user apps. | 5 | G3 | marketplace models + API | app → matches | marketplace rows |
| G9 | **Reality Feedback Brain** (Gap 10) — product telemetry → tasks/experiments. | 6 | G4 | ingest API → task generator | signal in → task out | generated task row |
| G10 | **SaaS layer** (Gap 9) — auth/orgs/roles/limits/audit. | 8 | — | NextAuth + models + route guards | unauthenticated → 401 | 401 test green |
| G11 | **Plugin/Skill marketplace** (Gap 11) — custom agents/tools registry (AgentTemplate/CustomTool exist — extend). | 5 | — | performance tracking on existing models | template perf rows | tracked rows |
| G12 | **Benchmark Arena** (Gap 12) — scored autonomy benchmarks over task suites. | 6 | G0 | BenchmarkRun model + suite runner | 2 runs → 2 scored rows | trend endpoint |
| G13 | **Dashboard UI** for boardroom/venture/aegis/customer/pipeline. | 6 | G0 | sections reading live APIs | panels render real rows | UI screenshot |

## Cycle 8 — DELIVERED: G0 (Integrated Autonomous Pipeline)

- `pipeline/company.ts`: `createCompany()` — DISCOVER (OPPORTUNITY, optional focus / existing opportunityId) → VENTURE (asserts AEGIS market claim) → CUSTOMER simulation → AEGIS subject aggregate → BOARDROOM debate over the full quantified context → **build gate** (MVP build via `dispatchGoal` only on GO/CONDITIONAL; NO_GO halts honestly). `VentureRun` model records every stage; `Company` row created on approval; `VENTURE_RUN.md` artifact; memory record; API `GET/POST /api/genesis/company`.
- **Acceptance test passed (real execution)**: RUN-000011, *no idea given* → discovered OPP-000002 → venture 58 WATCH · truth 7% · customer reality 72 (60% buy of 200 SIMULATED personas) · board CONDITIONAL 59% with condition “no evidence base” surfaced → full build **7/7 done** → company `co-opp-000002`. Artifact banners HEURISTIC mode + NO_WEB_EVIDENCE + SIMULATION labels throughout.
- **Bug found & fixed by this cycle's tests**: `count()+1` id allocation in VENTURE (`VC-`), CUSTOMER (`SIM-`), OPPORTUNITY (`OPP-`) collided after any row deletion (P2002). Replaced with numeric max-scan (same fix as EX-/CLM- ids). Full suite now stable across repeated runs.
- Verified: tsc ✓, eslint ✓, **70/70 tests ×3 runs** (5 new), build compiles `/api/genesis/company`.

## Re-audit (next, ranked)

The acceptance loop runs — but two things keep it from being *trustworthy* and *continuous*: (1) **G2 Approval Control Center** — before any acquisition/external-action work lands, the safety layer must exist; (2) **G1 World Scanner upgrade** — the discovery leg is the weakest gate (truth 7% fallback opportunities without a browser key); (3) **G5 Long-Horizon Operator** — "operate 90 days" is the last pipeline leg with no machinery. Recommended cycle-9 order: G2 → G5 → G1(needs key)/G13 dashboard.
