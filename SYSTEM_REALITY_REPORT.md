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

- **Authentication / authorization** — every API route is open.
- **LLM provider** — no key configured; every "intelligent" path silently falls back to rules. No support for providers other than z-ai SDK (no Anthropic/OpenAI adapter).
- **AI Boardroom** (directive Phase 4) — ✅ DELIVERED (cycle 4). Nine executive seats debate every dispatch → GO/CONDITIONAL/NO_GO verdict + `BOARD_DECISION.md`; wired into `dispatchGoal` (advisory by default, `enforceBoard` halts on NO_GO). LLM-optional, honestly labelled HEURISTIC without a key. `agent-runtime/boardroom/`, `/api/genesis/boardroom`, 6 tests.
- **AI Venture Analyst** (V6 Phase 3) — ✅ DELIVERED (cycle 5). Registered `VENTURE` agent scores 7 VC dimensions → `VENTURE_SCORE` + INVEST/WATCH/PASS; feeds the boardroom via dependency handoff. `agents/v6-venture.ts`, `/api/genesis/venture`, 6 tests. LLM-optional, HEURISTIC-labelled with declared unknowns.
- **AEGIS Truth Engine** (V6 Phase 1) — ✅ DELIVERED (cycle 6). `Claim`+`Evidence` ledger; no-evidence ⇒ UNSUPPORTED (truthScore 0); caps Venture INVEST→WATCH and Boardroom confidence. `agent-runtime/aegis/`, `/api/genesis/aegis`, 6 tests. Now every venture decision cites (or is flagged as lacking) evidence.
- **Digital Customer Simulation** (V7 Phase 2) — ✅ DELIVERED (cycle 7). CUSTOMER agent simulates N seeded personas → CUSTOMER_REALITY_SCORE; asserts a SIMULATION-typed AEGIS demand claim; feeds the board's Customer seat. `agents/v7-customer.ts`, `/api/genesis/customers`, 6 tests. Labelled SIMULATION, never real users.
- **Integrated Autonomous Pipeline** (V8 G0) — ✅ DELIVERED (cycle 8). `createCompany()` chains DISCOVER→AEGIS→VENTURE→CUSTOMER→BOARD→build gate; acceptance test passed with **no idea given** (RUN-000011: discovered → gates scored → board CONDITIONAL → 7/7 built → company record). `pipeline/company.ts`, `/api/genesis/company`, `VentureRun` model, 5 tests. Also fixed the `count()+1` id-collision bug across VC-/SIM-/OPP- ids.
- **Demand graph, acquisition loop, long-horizon operator, approval queue, arena/feedback/marketplace/benchmark engines** (V8 G1–G13) — not present. Approval Control Center (G2) is the ranked-highest next step (safety before external actions), then Long-Horizon Operator (G5).
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
2. **No LLM key** (HIGH for product value) — the system is a rule-based pipeline until a provider is configured; misleading "confidence" outputs.
3. **Stale RUNNING executions** — crashed runs leave `AgentExecution` rows in RUNNING forever (observed EX-000002); nothing reaps them.
4. **`nextTaskNumber`/id ordering is lexicographic** — breaks at `T-1000` (duplicate id → unique violation).
5. **Shell injection surface** — goal/topic strings are interpolated into shell commands (`commit -m "... ${topic}"`). Malicious goal text can execute commands. Needs arg-array spawning or escaping.

## NEXT BOTTLENECK

**LLM provider integration.** Every differentiating capability in the directive (boardroom debate, reality engine, market sensing, customer simulation, real repair loops) is blocked on an actual LLM. The system currently only exercises its deterministic skeleton. Add a provider-agnostic adapter (Anthropic-first), keep rule fallbacks, and make "no key" states honest in the UI instead of silent degradation.
