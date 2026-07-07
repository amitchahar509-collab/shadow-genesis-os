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
| 9 | **AI Boardroom / Reality Engine / customer sim / competition engine** (directive Phases 3,4,6,8) — blocked on #2 (LLM key). | 8 | Hard | CEO | Boardroom debate artifact precedes BUILD decisions | Dispatch mission; assert debate + vote records |

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
