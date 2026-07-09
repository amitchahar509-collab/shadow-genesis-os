# SYSTEM REALITY REPORT — Shadow Genesis OS

> Measured on 2026-07-08, Windows 11, Bun 1.3.14. Every claim below was verified by real execution on this machine, not inherited from prior reports.

## Environment reality (discovered this cycle)

The project arrived as a tar from a Linux workspace. This machine had **no Node, no Bun, no npm**, `.env` pointed at `/home/z/...`, and the C: drive had **0 bytes free**. None of the prior "production-ready" claims were reproducible until this cycle fixed the environment:

- Bun 1.3.14 installed (winget). No Node/npm exists — anything shelling to `npm` fails.
- Project physically relocated to `D:\shadow-os-dev\project`; `C:\Users\Dell\Downloads\shadow OS` is now a junction to it (C: is chronically full; Turbopack rejects a node_modules-only junction).
- `.env` fixed to `DATABASE_URL=file:../db/custom.db`.

## WORKING (verified by execution this cycle)

- **Toolchain**: `tsc --noEmit` 0 errors; `eslint src/ tests/` 0 errors; `bun test` 35/35 pass; `next build` succeeds (58 API routes).
- **Agent runtime**: 13 registered agents execute for real — DB rows (AgentExecution, ToolCall, Artifact), filesystem artifacts, git commits in sandboxes. Verified via full `dispatchGoal` runs.
- **CEO decomposition**: goal → 7-task pipeline with dependencies (rule-based fallback; LLM path untestable — no ZAI_API_KEY).
- **Tool layer**: filesystem/terminal/code/api/git/package tools work cross-platform after this cycle's shell fix. Permission allowlist enforced.
- **Memory engine**: episodic/semantic/procedural records written on every execution; Jaccard recall.
- **Persistence**: 39 Prisma models, SQLite at `db/custom.db`.

## PARTIALLY WORKING

- **Orchestrator pipeline**: two real bugs found and fixed this cycle (see below); end-to-end mission now under re-verification. Retries and per-agent mutex work.
- **RESEARCH / browser tool**: degrades gracefully but is effectively a no-op — `z-ai-web-dev-sdk` needs `ZAI_API_KEY`; without it every search/fetch fails and research reports contain 0 sources (confidence numbers still computed — misleading).
- **ENGINEERING repair loop**: LLM patching unavailable without API key; rule-based patching only handles "not exported/defined" errors.
- **DEPLOYMENT**: builds and health-checks locally; `nohup` background start now cross-platform (was Linux-only `setsid`), but no re-verified end-to-end deploy on Windows yet.
- **Activity service** (`mini-services/activity-service`): real-event broadcaster, but must be started manually; dashboard falls back to polling.

## FAKE / SIMULATED

- **Research confidence scores**: formula-derived from source count, presented as confidence even when 0 sources were fetched.
- **QUALITY generated tests**: smoke tests only (`expect(typeof X).toBeDefined()`); they cannot fail meaningfully.
- **V2 seed narrative data** (25 tasks, decisions, metrics) still mixes with real runtime data in the same tables.

## MISSING

- **Authentication / authorization** — ✅ core DELIVERED (cycle 15, G10). Hashed API-key auth + orgs + roles (OWNER/ADMIN/MEMBER/VIEWER) + audit log; `GENESIS_AUTH_REQUIRED=1` enforces on the 4 highest-risk mutation routes (approvals/company/operator/feedback) — 401/403 without a valid key, reads stay open, local dev unchanged. `auth/`, `/api/genesis/auth`, 6 tests, live-proven. Remaining: mechanical guard rollout to the other write routes + optional per-org usage limits.
- **LLM provider** — no key configured; every LLM-gated path falls back to rules. As of cycle 21 this is NO LONGER SILENT: `agent-runtime/provider/` + `/api/genesis/provider` + a dashboard DEGRADED badge surface the reasoning mode and a capability matrix (which gates are HEURISTIC vs LLM right now; procedural-by-design gates marked EXACT, not degraded). A real self-test round-trips the actual adapter (proven: a dummy key produces a genuine Anthropic 401 with a request_id after a 1.5s network call — the path executes end-to-end). One valid `ANTHROPIC_API_KEY` flips every LLM-gated gate to real reasoning with zero code change.
- **AI Boardroom** (directive Phase 4) — ✅ DELIVERED (cycle 4). Nine executive seats debate every dispatch → GO/CONDITIONAL/NO_GO verdict + `BOARD_DECISION.md`; wired into `dispatchGoal` (advisory by default, `enforceBoard` halts on NO_GO). LLM-optional, honestly labelled HEURISTIC without a key. `agent-runtime/boardroom/`, `/api/genesis/boardroom`, 6 tests.
- **AI Venture Analyst** (V6 Phase 3) — ✅ DELIVERED (cycle 5). Registered `VENTURE` agent scores 7 VC dimensions → `VENTURE_SCORE` + INVEST/WATCH/PASS; feeds the boardroom via dependency handoff. `agents/v6-venture.ts`, `/api/genesis/venture`, 6 tests. LLM-optional, HEURISTIC-labelled with declared unknowns.
- **AEGIS Truth Engine** (V6 Phase 1) — ✅ DELIVERED (cycle 6). `Claim`+`Evidence` ledger; no-evidence ⇒ UNSUPPORTED (truthScore 0); caps Venture INVEST→WATCH and Boardroom confidence. `agent-runtime/aegis/`, `/api/genesis/aegis`, 6 tests. Now every venture decision cites (or is flagged as lacking) evidence.
- **Digital Customer Simulation** (V7 Phase 2) — ✅ DELIVERED (cycle 7). CUSTOMER agent simulates N seeded personas → CUSTOMER_REALITY_SCORE; asserts a SIMULATION-typed AEGIS demand claim; feeds the board's Customer seat. `agents/v7-customer.ts`, `/api/genesis/customers`, 6 tests. Labelled SIMULATION, never real users.
- **Integrated Autonomous Pipeline** (V8 G0) — ✅ DELIVERED (cycle 8). `createCompany()` chains DISCOVER→AEGIS→VENTURE→CUSTOMER→BOARD→build gate; acceptance test passed with **no idea given** (RUN-000011: discovered → gates scored → board CONDITIONAL → 7/7 built → company record). `pipeline/company.ts`, `/api/genesis/company`, `VentureRun` model, 5 tests. Also fixed the `count()+1` id-collision bug across VC-/SIM-/OPP- ids.
- **Approval Control Center** (V8 G2) — ✅ DELIVERED (cycle 9). `ApprovalRequest` queue with transparent rule-based risk scoring; api-tool enforcement (external HTTP writes block with `APPROVAL_REQUIRED`); approvals are single-use (APPROVED→EXECUTED atomically); pending expires in 24h. `agent-runtime/approvals/`, `/api/genesis/approvals`, 8 tests, human-in-the-loop e2e proven.
- **Long-Horizon Operator** (V8 G5) — ✅ DELIVERED (cycle 10). Tick-driven, restart-safe 30/60/90-day missions: DAILY real-metric reviews (failures spawn QUALITY tasks), WEEKLY venture re-checks, MONTHLY board SCALE/PIVOT/KILL/DOUBLE_DOWN (KILL pauses the company), FINAL at horizon. `createCompany` hands BUILT companies to a 30-day mission. `agent-runtime/operator/`, `/api/genesis/operator`, 8 tests, full-life e2e proven. Ticks need an external cron hitting `tickAll` — no hidden daemon by design.
- **Autonomous Acquisition Engine** (V8 G4) — ✅ DELIVERED (cycle 11). ACQUISITION agent runs the experiment ladder (PRICING → AUDIENCE → CHANNEL) with experiment memory on extended `GrowthExperiment` rows; simulated measurements labelled SIMULATION (deliberately kept out of GrowthMetric); CHANNEL experiments are real external actions gated by the approval queue and never fabricate results. Wired into the operator's weekly loop. `agents/v8-acquisition.ts`, `/api/genesis/acquisition`, 7 tests, operated-mission e2e proven.
- **Dashboard UI for the intelligence stack** (V8 G13) — ✅ DELIVERED (cycle 12). Two live tabs: Venture Intelligence (pipeline runs, AEGIS claims, venture analyses, customer sims, board decisions — honesty chips surfaced; CREATE COMPANY button) and Mission Control (interactive approval queue, mission progress + TICK ALL, experiment memory). Verified: SSR renders both tabs, all 7 backing APIs live, approve + tick button paths exercised. Note: Next 16 dev must run from `D:\shadow-os-dev\project` (the Downloads junction breaks dev-server path resolution).
- **Benchmark Arena** (V8 G12) — ✅ DELIVERED (cycle 13). Real-execution scored suite measuring discrimination (rank strong>weak, refuse unsupported confidence) across EVIDENCE/VENTURE/CUSTOMER/BOARD/CHAIN + optional BUILD; autonomy score, success rate, real ms/tokens, trend history; dashboard panel. `benchmark/`, `/api/genesis/benchmark`, `BenchmarkRun`, 5 tests, live run 100/100 in heuristic mode.
- **Reality Feedback Brain** (V8 G9) — ✅ DELIVERED (cycle 14). Deployed products POST REAL telemetry to `/api/genesis/feedback`; the brain reacts: errors→QUALITY tasks, negative feedback→ENGINEERING, feature requests→GROWTH, usage/retention→real GrowthMetric, conversions→completes the acquisition CHANNEL experiment with dataSource=REAL (closing the boundary the Acquisition Engine left open). Every signal→memory. Reuses/extends `RealitySignal`. `reality-feedback/`, 7 tests, full-loop e2e proven (real conversion 37/920→4% LEARNED/REAL).
- **Agent Arena** (V8 G6) — ✅ DELIVERED (cycle 16). ALPHA/BETA/GAMMA make distinct strategic bets on the same mission, scored by the real VENTURE+CUSTOMER+AEGIS stack; a judge weights 7 dimensions and picks winner = argmax(score) (never hardcoded; input-driven, tested); board reviews the winner; winning/failed patterns → memory. `arena/`, `/api/genesis/arena` (ADMIN), dashboard panel, 6 tests, acceptance-run proven.
- **Agent Evolution** (V8 G7) — ✅ DELIVERED (cycle 17). Engine reads real AgentMetric + recurring FailureAnalysis per agent → NO_ACTION / IMPROVE_PROMPT (corrective guard via prompt-versioning) / RETIRE_WORKFLOW (rollback active prompt) / CREATE_SPECIALIST (propose AgentTemplate). Honest: no data ⇒ no action; sweeps default to dry-run; every action stores its metric snapshot + reason. `evolution/`, `/api/genesis/evolution` (ADMIN), dashboard panel, 8 tests, e2e-proven.
- **Demand Graph + Product DNA** (V8 G3) — ✅ DELIVERED (cycle 18). Product DNA fingerprint + Customer Match ranks demand segments by market fit (real seeded-sim adoption + category↔industry affinity) → DEMAND_MATCH_SCORE + who/where/why-now/urgency; projects into the KnowledgeNode/KnowledgeEdge graph. `demand/`, `/api/genesis/demand`, dashboard panel, 7 tests, e2e-proven.
- **App Demand Marketplace** (V8 G8) — ✅ DELIVERED (cycle 19). Apps register with Product DNA + auto demand match; bidirectional matching (app→demand, problem→apps with a relevance gate) + marketplace intelligence (category coverage + demand gaps as opportunity signals). `marketplace/`, `/api/genesis/marketplace`, dashboard panel, 6 tests, e2e-proven.
- **World Scanner Engine** (V8 G1) — ✅ DELIVERED (cycle 20). Discovers problems from Genesis's OWN accumulated real intelligence (reality-feedback signals, marketplace demand gaps, failed ventures) with frequency/urgency/who-suffers/opportunity-score, AEGIS-verified; promotes into the build pipeline; web scanning activates with a search key (honest NO_WEB label otherwise). `world-scanner/`, `/api/genesis/world`, dashboard panel, 6 tests, e2e-proven (World→AEGIS→Venture→Customer).
- **V8 COMPLETE — 13/13 gaps closed** + LLM-path force-multiplier (cycle 21: provider status/badge/self-test — degradation made honest and one key away from real reasoning). Remaining is hardening: guard rollout to remaining write routes + usage limits, G11 plugin perf tracking, and the pre-existing standalone-build/junction env debt. The single highest-value action is now operational, not code: **set a valid `ANTHROPIC_API_KEY`** to activate real reasoning + web scanning across the whole stack.
- **Self-benchmark system** (Phase 12) — `scripts/verify-mission.ts` added this cycle as the first real benchmark; no scoring/history yet.
- **CI pipeline** — nothing runs on commit.

## PRODUCTION BLOCKERS (fixed this cycle)

1. ~~`spawn("/bin/sh")` hardcoded~~ → cross-platform shell resolver (`agent-runtime/shell.ts`), Git Bash on Windows, backslash-path normalization. Restored 3 failing tests → 35/35.
2. ~~Unquoted interpolated paths in agent commands~~ → quoted; also fixed a latent bug where `"cd ${repoPath}"` in a **plain string** (never interpolated) made every Next.js build run in the wrong directory.
3. ~~ExecutionId race~~ → parallel task launches minted duplicate `EX-` ids and crashed missions with P2002. Now serialized + retry-on-conflict.
4. ~~False deadlock in `runPipeline`~~ → deadlock check ran after `Promise.race` with a stale `progress` flag, killing every mission at the ENGINEERING step. Also: completed task results were silently dropped from `taskResults`.
5. ~~Linux-only deploy command~~ (`setsid`, `/tmp`) → portable `nohup` + repo-local log.
6. ~~Disk full~~ → project on D:, caches on D:, ~1.2 GB freed on C:.

## PRODUCTION BLOCKERS (remaining)

1. **No auth** (HIGH) — anyone can trigger missions/agents.
2. **No LLM key** (HIGH for product value) — the system runs its rule-based pipeline until a provider is configured. No longer misleading: the provider status + DEGRADED badge + capability matrix (cycle 21) make the heuristic mode explicit and self-testable; a valid `ANTHROPIC_API_KEY` activates real reasoning everywhere.
3. **Stale RUNNING executions** — crashed runs leave `AgentExecution` rows in RUNNING forever (observed EX-000002); nothing reaps them.
4. **`nextTaskNumber`/id ordering is lexicographic** — breaks at `T-1000` (duplicate id → unique violation).
5. **Shell injection surface** — goal/topic strings are interpolated into shell commands (`commit -m "... ${topic}"`). Malicious goal text can execute commands. Needs arg-array spawning or escaping.

## NEXT BOTTLENECK

**LLM provider integration.** Every differentiating capability in the directive (boardroom debate, reality engine, market sensing, customer simulation, real repair loops) is blocked on an actual LLM. The system currently only exercises its deterministic skeleton. Add a provider-agnostic adapter (Anthropic-first), keep rule fallbacks, and make "no key" states honest in the UI instead of silent degradation.
