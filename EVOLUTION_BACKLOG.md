# EVOLUTION BACKLOG — Shadow Genesis OS

> Ranked by measured impact. Every item has success criteria and a test method. Updated 2026-07-08 after the Windows-portability cycle.

| # | Task | Impact | Difficulty | Owner agent | Success criteria | Test method |
|---|------|--------|-----------|-------------|------------------|-------------|
| 1 | **Auth (NextAuth credentials + User model)** — every route is open today. | 8 | Hard | SECURITY | Unauthenticated API calls return 401; dashboard has login | Integration test hitting /api/genesis/* without session |
| 2 | **Exercise the LLM path** — adapter shipped (Anthropic-first); needs a real `ANTHROPIC_API_KEY` to validate quality of CEO plans, repair loops, research synthesis. Surface "DEGRADED (no LLM)" in dashboard. | 9 | Easy (needs key) | CEO | With key: goal-specific plans; without: visible DEGRADED badge | Run mission with key; UI shows provider status |
| 3 | **Shell-injection hardening** — goal/topic strings are interpolated into shell commands (`git commit -m "... ${topic}"`). | 7 | Medium | SECURITY | Malicious goal text cannot execute commands | Test goal containing `"; rm -rf` runs safely |
| 4 | **Meaningful generated tests** — QUALITY's generated tests are `typeof X` smoke checks that cannot fail. | 5 | Medium | QUALITY | Generated tests execute exported functions and assert behavior | Run QUALITY on a repo with a real bug; test must fail |
| 5 | **Benchmark history + scoring** (directive Phase 12) — persist verify-mission runs with duration/task-success scores; trend over time. | 5 | Medium | QUALITY | BenchmarkRun table + `/api/genesis/benchmarks`; each run recorded | Run benchmark twice, assert 2 rows with scores |
| 6 | **Deployed-server lifecycle** — verify-mission leaves the deployed server running; DEPLOYMENT should register the PID and support stop/rollback (HealthMonitor integration). | 6 | Medium | DEPLOYMENT | Deployments can be stopped via API; no orphaned ports | Deploy, stop via API, port freed |
| 7 | **Seed/real data separation** — V2 narrative seed rows mix with runtime data. | 4 | Easy | ENGINEERING | `seeded` flag or namespace; dashboard filter | Query excludes seed rows |
| 8 | **CI pipeline** — GitHub Actions: typecheck, lint, test, build on push (needs a remote first). | 5 | Easy | SRE | Green workflow on push | Push a commit, watch workflow |
| 9 | ~~**AI Boardroom** (directive Phase 4)~~ — ✅ DELIVERED cycle 4. Remaining: customer simulation (Phase 3), competition engine (Phase 9), reality engine. LLM-optional (works today, richer with a key). | 8 | Hard | CEO | ~~Boardroom debate artifact precedes BUILD decisions~~ ✅ | ~~Dispatch mission; assert debate + vote records~~ ✅ 6 tests |
| 10 | **Digital Customer Simulation** (directive Phase 3) — 1000 personas evaluate would-they-buy before launch; MARKET_SIMULATION_REPORT. Needs LLM for persona reasoning; heuristic scoring meanwhile. | 7 | Hard | CUSTOMER | Sim report with buy/no-buy distribution + objections | Run sim; assert persona rows + report artifact |
| 11 | **Approval Queue** (directive Phase 11) — payments/emails/posting gated behind human approval. Fields (`requiresApproval`) exist; no queue/API/UI. | 7 | Medium | SECURITY | External actions enqueue + block until approved | Enqueue action; assert blocked until approved |
| 12 | ~~**AI Venture Analyst** (V6 Phase 3)~~ — ✅ DELIVERED cycle 5. VC-lens VENTURE_SCORE feeds the boardroom. Remaining: run it automatically in the pipeline before the board (CEO plan should insert a VENTURE task ahead of build). | 7 | Medium | VENTURE | ~~VENTURE_SCORE per opportunity; feeds board~~ ✅ | ~~Score strong>weak; board consumes score~~ ✅ 6 tests |
| 13 | **Auto-insert VENTURE + BOARD gate in CEO plans** (NEVER STOP, cycle-5 self-audit) — the CEO decomposition should place a VENTURE task, then a boardroom gate, ahead of ENGINEERING so every real mission is evidence-scored and debated before build spend. | 6 | Medium | CEO | Rule-based + LLM plans include VENTURE→BOARD before ENGINEERING | Dispatch mission; assert task order |
| 14 | **AEGIS Truth Engine** (V6 Phase 7, NEVER STOP self-audit) — a claim ledger (claim/evidence/source/confidence/contradictions/unknowns) that gates decisions on evidence. The weakest data today is unverified `confidence`/`marketSize`; this is the anti-hallucination backbone. | 8 | Hard | RESEARCH | Decisions cite evidence rows; unsupported claims flagged | Assert a 0-evidence opportunity is flagged UNSUPPORTED |

## Completed cycle 5 (2026-07-08) — AI Venture Analyst (V6 Phase 3)

- **AI Venture Analyst**: new registered agent `VENTURE` scores an opportunity (or raw goal) on seven VC dimensions — market size, timing, moat, competition, distribution, founder advantage, growth potential — into a weighted `VENTURE_SCORE` (0-100) and an INVEST/WATCH/PASS verdict with a written thesis. Distinct from BUSINESS_VALIDATION's demand/feasibility lens. Persisted as `VentureAnalysis`; artifact `VENTURE_SCORE.md`.
- **Composes with the Boardroom**: the analyst's `ventureScore`/dimensions flow through the orchestrator's dependency handoff into the board context; `readSignals` now prefers a venture score over raw signals, so the board debates a quantified venture. Verified e2e: STRONG → VENTURE 79 INVEST → BOARD GO 77% (7-0); WEAK → VENTURE 27 PASS → BOARD NO_GO 84% (0-9).
- **Honesty (anti-faking)**: heuristic scores are labelled `mode: HEURISTIC`, the artifact banners it, and `unknowns` explicitly declares what is assumed rather than measured (e.g. founder advantage baseline 50) — a thin analysis can never masquerade as conviction.
- **API**: `GET/POST /api/genesis/venture`. Registered VENTURE in registry, collab graph, and tool permissions.
- Verified: tsc ✓, eslint ✓, 53/53 tests (6 new), `next build` compiles the new route.
- **NEVER STOP self-audit** → auto-created tasks #13 (wire VENTURE+BOARD into the CEO plan) and #14 (AEGIS Truth Engine — the remaining weakest link is unverified evidence behind confidence/market-size numbers).

## Completed cycle 4 (2026-07-08) — AI Boardroom (Phase 4)

- **AI Boardroom**: nine executive seats (Founder, CEO, Investor, Customer, Competitor, CFO, Growth, Engineer, Risk) each argue a decision from their own incentive, tallied into a GO/CONDITIONAL/NO_GO verdict with a written synthesis, surfaced conditions, and risks. Persisted as `BoardDecision` + `BoardArgument`; rendered to `BOARD_DECISION.md`.
- **Wired into `dispatchGoal`**: board convenes after CEO decomposition, before the build pipeline. Advisory by default (records verdict + emits); `enforceBoard` halts on a NO_GO (Risk Officer holds a confident-NO_GO veto). Verified e2e: a weak/risky goal → unanimous NO_GO 85% → pipeline halted before build.
- **Honesty (anti-faking)**: without an LLM every stance is a labelled rule-based heuristic over the numeric signals (`mode: HEURISTIC`); the artifact banners this and each seat states "not reasoned judgement." With a key each seat argues via the provider (`mode: LLM`, or `MIXED` on partial fallback).
- **API**: `GET/POST /api/genesis/boardroom` (list decisions / convene ad-hoc / list seats). New module `agent-runtime/boardroom/`.
- Verified: tsc ✓, eslint ✓, 47/47 tests (6 new), `next build` compiles the new route. (`bun run build`'s post-compile standalone copy still fails on the Windows junction — pre-existing, unrelated.)

## Completed cycles 2–3 (2026-07-08)

- **Cross-task context handoff**: orchestrator passes dependency outputs (repoPath, stack→stackHint, topic) into dependent tasks. QUALITY now scans the real repo (3 tests vs 0); DEPLOYMENT builds/serves the actual artifact.
- **Honest agents**: DEPLOYMENT throws on missing repoPath, skips serve for CLI/library stacks, fails on unhealthy server deploys; RESEARCH reports confidence 0% with 0 sources.
- **Hang-proof shell**: `sh()`/`runInSandbox` resolve on `exit` + flush grace — detached deployed servers held stdio handles so `close` never fired on Windows, hanging every server-stack mission at DEPLOYMENT.
- **Orphaned-execution reaper** at every dispatch; **numeric id allocation** (lexicographic broke at digit rollover).
- **LLM provider adapter**: `ANTHROPIC_API_KEY` (preferred, `claude-sonnet-5` default) or `ZAI_API_KEY`; env validation + README updated.
- Verified end-to-end: CLI mission 7/7 DONE; REST API mission 7/7 DONE with live healthy server on :3001 serving real JSON (`GET /items` → `[]`). 41/41 tests, tsc/eslint/build clean.

## Completed cycle 1 (2026-07-08)

- Cross-platform shell execution (`agent-runtime/shell.ts`): Git Bash resolution on Windows, backslash normalization — restored terminal/sandbox/git/package tools on Windows (3 failing tests → 35/35).
- Quoted all interpolated paths in agent commands; fixed never-interpolated `"cd ${repoPath}"` plain-string bug in ENGINEERING's Next.js build branch.
- ExecutionId allocation race (P2002 mission crash) → serialized allocation + retry.
- False-deadlock bug in `runPipeline` (stale `progress` flag checked after `Promise.race`) — every mission previously died at the ENGINEERING step; also fixed dropped task results in `taskResults`.
- Linux-only deploy start (`setsid`, `/tmp`) → portable `nohup` + repo-local log.
- Environment: Bun installed, deps installed, prisma client generated, `.env` fixed, project relocated to D: (C: was 100% full), `scripts/verify-mission.ts` benchmark added.
- Verified: tsc ✓, eslint ✓, 35/35 tests ✓, next build ✓, full 7-task mission PASS end-to-end.
