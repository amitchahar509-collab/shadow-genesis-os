# EVOLUTION BACKLOG — Shadow Genesis OS

> Ranked by measured impact. Every item has success criteria and a test method. Updated 2026-07-08 after the Windows-portability cycle.

| # | Task | Impact | Difficulty | Owner agent | Success criteria | Test method |
|---|------|--------|-----------|-------------|------------------|-------------|
| 1 | **Cross-task context handoff** — orchestrator must pass dependency outputs (repoPath, stack, topic) into dependent tasks' context. Today DEPLOYMENT gets "no repoPath" and QUALITY scans an empty dir yet both count DONE (vacuous success). | 9 | Medium | ENGINEERING | DEPLOYMENT receives the repo built by ENGINEERING; QUALITY scans real sources (>0 files) | `bun run scripts/verify-mission.ts` — DEPLOYMENT summary must reference a real path/URL, QUALITY must report sourcesScanned > 0 |
| 2 | **LLM provider adapter** — provider-agnostic `callLlm` (Anthropic-first), honest "no key" surfacing in UI/DB instead of silent rule fallback. | 9 | Medium | ARCHITECT | With a key set, CEO plans vary by goal; without, dashboard shows DEGRADED badge | Unit test with mock provider; manual run with key |
| 3 | **Honest research output** — when 0 sources fetched, confidence must be 0/UNAVAILABLE, not 50%. | 7 | Easy | RESEARCH | Report with 0 sources shows confidence 0 and status DEGRADED | Unit test on ResearchAgent with browser tool failing |
| 4 | **Auth (NextAuth credentials + User model)** — every route is open today. | 8 | Hard | SECURITY | Unauthenticated API calls return 401; dashboard has login | Integration test hitting /api/genesis/* without session |
| 5 | **Stale RUNNING execution reaper** — crashed runs leave AgentExecution RUNNING forever (observed EX-000002). | 6 | Easy | SRE/DEPLOYMENT | Startup + periodic job marks RUNNING rows older than 1h as FAILED("orphaned") | Insert fake stale row, run reaper, assert FAILED |
| 6 | **Numeric id allocation** — `T-`/`EX-` ids sorted lexicographically break at 4 digits (T-999 > T-1000 → duplicate → P2002). | 6 | Easy | ENGINEERING | Ids allocated correctly past 999 | Unit test seeding T-999 then requesting next |
| 7 | **Shell-injection hardening** — goal/topic strings are interpolated into shell commands (`git commit -m "... ${topic}"`). | 7 | Medium | SECURITY | Malicious goal text cannot execute commands | Test goal containing `"; rm -rf` runs safely |
| 8 | **Meaningful generated tests** — QUALITY's generated tests are `typeof X` smoke checks that cannot fail. | 5 | Medium | QUALITY | Generated tests execute exported functions and assert behavior | Run QUALITY on a repo with a real bug; test must fail |
| 9 | **Benchmark history + scoring** (directive Phase 12) — persist verify-mission runs with duration/task-success scores; trend over time. | 5 | Medium | QUALITY | BenchmarkRun table + `/api/genesis/benchmarks`; each run recorded | Run benchmark twice, assert 2 rows with scores |
| 10 | **Seed/real data separation** — V2 narrative seed rows mix with runtime data. | 4 | Easy | ENGINEERING | `seeded` flag or namespace; dashboard filter | Query excludes seed rows |
| 11 | **CI pipeline** — GitHub Actions: typecheck, lint, test, build on push. | 5 | Easy | SRE | Green workflow on push | Push a commit, watch workflow |
| 12 | **AI Boardroom / Reality Engine / customer sim / competition engine** (directive Phases 3,4,6,8) — blocked on #2 (LLM). | 8 | Hard | CEO | Boardroom debate artifact precedes BUILD decisions | Dispatch mission; assert debate + vote records |

## Completed this cycle (2026-07-08)

- Cross-platform shell execution (`agent-runtime/shell.ts`): Git Bash resolution on Windows, backslash normalization — restored terminal/sandbox/git/package tools on Windows (3 failing tests → 35/35).
- Quoted all interpolated paths in agent commands; fixed never-interpolated `"cd ${repoPath}"` plain-string bug in ENGINEERING's Next.js build branch.
- ExecutionId allocation race (P2002 mission crash) → serialized allocation + retry.
- False-deadlock bug in `runPipeline` (stale `progress` flag checked after `Promise.race`) — every mission previously died at the ENGINEERING step; also fixed dropped task results in `taskResults`.
- Linux-only deploy start (`setsid`, `/tmp`) → portable `nohup` + repo-local log.
- Environment: Bun installed, deps installed, prisma client generated, `.env` fixed, project relocated to D: (C: was 100% full), `scripts/verify-mission.ts` benchmark added.
- Verified: tsc ✓, eslint ✓, 35/35 tests ✓, next build ✓, full 7-task mission PASS end-to-end.
