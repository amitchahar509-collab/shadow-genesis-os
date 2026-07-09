# V8_COMPLETION_QUEUE — Shadow Genesis OS

> Ranked by impact. Created 2026-07-09 (V8 loop, Phase 0). Extend existing systems — never rebuild, never duplicate.

| # | Gap (V8) | Impact | Depends | Implementation plan | Test method | Completion proof |
|---|----------|--------|---------|---------------------|-------------|------------------|
| G0 | ~~**Integrated autonomous pipeline**~~ — ✅ DELIVERED cycle 8. `createCompany()` chains DISCOVER→AEGIS→VENTURE→CUSTOMER→BOARD→BUILD gate; `VentureRun` record; reuses `Company`. | 10 | all gates ✓ | ✅ `pipeline/company.ts`; `/api/genesis/company` | ✅ 5 tests: NO_GO halts, strong passes, honesty labels, autonomous discovery, honest failure | ✅ Acceptance run RUN-000011: no idea → discovered → gates scored → board CONDITIONAL 59% → **7/7 BUILT** → company + VENTURE_RUN.md |
| G1 | **World Scanner upgrade** (Gap 1) — add frequency/urgency/who-suffers to OPPORTUNITY output → WORLD_PROBLEM_GRAPH. | 7 | G0 | extend OPPORTUNITY prompt+fallback+model fields | scan → graph has urgency/sufferers | graph artifact fields populated |
| G2 | ~~**Approval Control Center**~~ (Gap 8) — ✅ DELIVERED cycle 9. `ApprovalRequest` queue + transparent risk scoring + api-tool enforcement (external HTTP writes block); approvals single-use; pending expires 24h. | 8 | — | ✅ `approvals/` module + `/api/genesis/approvals` (GET/POST/PATCH) + api-tool gate | ✅ 8 tests | ✅ e2e: blocked (APR-000001, risk 45) → human approve → executes once → replay blocked, status EXECUTED |
| G3 | **Demand Graph + Customer Match** (Gap 2) — problem↔user↔industry↔product mapping; DEMAND_MATCH_SCORE. | 7 | G0 | ProductDNA/DemandMatch models + MATCH agent | product → ranked matches | match rows + artifact |
| G4 | **Acquisition loop** (Gap 4) — hypothesis→experiment→measure→learn over GrowthExperiment; experiment memory. | 7 | G3, G2 | ACQUISITION agent + loop runner | experiment rows w/ learning | loop advances state machine |
| G5 | ~~**Long-Horizon Operator**~~ (Gap 5) — ✅ DELIVERED cycle 10. Tick-driven (restart-safe) 30/60/90-day missions: DAILY real-metric reviews (failures → QUALITY tasks), WEEKLY venture re-checks (drift flags), MONTHLY board decision (SCALE/PIVOT/KILL/DOUBLE_DOWN; KILL pauses the company), FINAL at horizon. Pipeline hands BUILT companies to a 30-day mission automatically. | 7 | G0 ✓ | ✅ `operator/` + `LongMission`/`OperatorReview` + `/api/genesis/operator` (tick/tickAll/pause/resume) | ✅ 8 tests (simulated time recorded as asOf) | ✅ e2e: company from nothing → BUILT → LM-000002 → 10 reviews over 30 simulated days → monthly PIVOT → COMPLETED |
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

## Re-audit after cycle 10 (next, ranked)

The directive's final pipeline now runs end-to-end: signals → discover → evidence → venture → customers → board → build → **operate 30/60/90 days** → learn (reviews feed memory + QUALITY tasks). Every leg exists; ticks need an external scheduler (cron hitting `PATCH /api/genesis/operator {action:"tickAll"}`) — no hidden daemon by design. Remaining ranked: (1) **G4 Acquisition loop** — the operate phase currently only watches; it should also run growth experiments (safely, via the G2 approval queue); (2) **G13 dashboard UI** — six intelligence systems are API-only; (3) **G1 World Scanner upgrade** — discovery is the weakest gate without a browser key (truth 7% fallback); (4) **G12 Benchmark Arena** / **G10 SaaS layer**.
