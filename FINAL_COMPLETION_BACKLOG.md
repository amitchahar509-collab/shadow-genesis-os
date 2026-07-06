# FINAL COMPLETION BACKLOG — Shadow Genesis OS

> Every task to reach production readiness. Ordered by priority (biggest impact first).

**Status legend**: `TODO` → `IN_PROGRESS` → `REVIEW` → `DONE` → `BLOCKED`

---

## PHASE 1 — REMOVE FAKE SYSTEMS

### FC-001 — Replace fake activity service with real-event broadcaster
- **Priority**: CRITICAL
- **Impact**: Dashboard activity feed currently shows fake events. Users cannot tell what's real.
- **Owner**: PRINCIPAL_ENGINEER
- **Files**: `mini-services/activity-service/index.ts`
- **Definition of done**: Activity service has NO fake templates. Accepts real events via HTTP `/broadcast`. Socket.io protocol unchanged (dashboard client works without modification). 30s heartbeat pulls real queue status.
- **Validation**: Start service, hit `/health` → 200. POST a real event to `/broadcast` → socket.io clients receive it. No fake events appear.
- **Status**: TODO

### FC-002 — Clear seed data on fresh install, add "reset" API
- **Priority**: HIGH
- **Impact**: Seed data mixes with real data, confusing users.
- **Owner**: PRINCIPAL_ENGINEER
- **Files**: `src/lib/genesis/seed.ts`, `src/app/api/genesis/seed/route.ts`
- **Definition of done**: Seed endpoint has `?mode=real-only` that clears seeded narrative data. Default behavior unchanged (seed on first install). New endpoint `DELETE /api/genesis/seed` clears all data except user accounts.
- **Validation**: Call clear endpoint, verify ActivityLog/GenesisTask counts drop to only real entries.
- **Status**: TODO

---

## PHASE 2 — REAL USER EXPERIENCE

### FC-003 — Build V4 dashboard with all features exposed
- **Priority**: CRITICAL
- **Impact**: Users cannot use any V3/V4 feature from the UI. This is the biggest gap.
- **Owner**: FRONTEND
- **Files**: `src/components/genesis/genesis-dashboard.tsx` (new), `src/components/genesis/sections/*` (new)
- **Definition of done**: Dashboard has 10 tabs: Command Center, Agents, Tasks, Missions, Memory, Messages, Security, Observability, Sandboxes, Genesis State. Each tab fetches real data from the API. Mission input ("Build my idea") prominent on Command Center.
- **Validation**: Load dashboard, click each tab, verify real data renders. Type a goal, dispatch, verify mission appears in Missions tab.
- **Status**: TODO

### FC-004 — Mission input ("Build my idea")
- **Priority**: CRITICAL
- **Impact**: Users cannot trigger the autonomous pipeline from the UI.
- **Owner**: FRONTEND
- **Files**: `src/components/genesis/sections/command-center.tsx`
- **Definition of done**: Command Center has a prominent input: "Build my idea: ___". Submitting calls `POST /api/genesis/v4/dispatch` with `background: true`. Shows success message with mission ID. Mission appears in Missions tab.
- **Validation**: Type a goal, submit, verify mission ID returned, verify mission appears in Missions tab.
- **Status**: TODO

### FC-005 — Live mission tracking
- **Priority**: HIGH
- **Impact**: Users cannot see mission progress.
- **Owner**: FRONTEND
- **Files**: `src/components/genesis/sections/missions.tsx` (new)
- **Definition of done**: Missions tab lists all missions (from `GET /api/genesis/orchestrator/missions`). Each mission shows: ID, goal, status, startedAt, duration. Clicking a mission shows its task results. Auto-refreshes every 5s while any mission is RUNNING.
- **Validation**: Dispatch a mission, verify it appears, verify status updates from RUNNING → COMPLETE.
- **Status**: TODO

### FC-006 — Decision approval queue
- **Priority**: HIGH
- **Impact**: Users cannot approve/reject agent decisions.
- **Owner**: FRONTEND
- **Files**: `src/components/genesis/sections/decisions.tsx` (new)
- **Definition of done**: Decisions tab lists pending decisions (from `GET /api/genesis/decisions` filtered by `humanStatus=PENDING`). Each has APPROVE and REJECT buttons that call `PATCH /api/genesis/decisions/[id]`.
- **Validation**: Create a decision via API, verify it appears, approve it, verify status changes.
- **Status**: TODO

### FC-007 — Agents tab with live state + pause/resume
- **Priority**: HIGH
- **Impact**: Users cannot see which agents are running or pause them.
- **Owner**: FRONTEND
- **Files**: `src/components/genesis/sections/agents.tsx` (new)
- **Definition of done**: Agents tab lists all 13 agents with their state (IDLE/EXECUTING/PAUSED/etc.), current execution ID, current task ID. Each has PAUSE/RESUME buttons that call `PATCH /api/genesis/agents/states`. Shows agent description + department.
- **Validation**: Load tab, verify 13 agents listed. Pause an agent, verify state changes.
- **Status**: TODO

### FC-008 — Observability tab
- **Priority**: MEDIUM
- **Impact**: Users cannot see agent performance metrics.
- **Owner**: FRONTEND
- **Files**: `src/components/genesis/sections/observability.tsx` (new)
- **Definition of done**: Observability tab shows: agent performance table (success rate, avg/p95 duration, tool calls, artifacts, errors from `GET /api/genesis/metrics/summary`), cost summary (tokens + USD from `GET /api/genesis/metrics/cost`), recent errors list, test pass rate.
- **Validation**: Load tab, verify real metrics render for agents that have run.
- **Status**: TODO

### FC-009 — Security tab
- **Priority**: MEDIUM
- **Impact**: Users cannot see security findings.
- **Owner**: FRONTEND
- **Files**: `src/components/genesis/sections/security.tsx` (new)
- **Definition of done**: Security tab shows: findings list (from `GET /api/genesis/security`), grouped by severity. Release-check status (from `GET /api/genesis/security/release-check`). Each finding has ACKNOWLEDGE/FIX/FALSE_POSITIVE buttons.
- **Validation**: Run SECURITY agent, verify findings appear in tab.
- **Status**: TODO

### FC-010 — Sandboxes tab
- **Priority**: LOW
- **Impact**: Users cannot manage sandboxes.
- **Owner**: FRONTEND
- **Files**: `src/components/genesis/sections/sandboxes.tsx` (new)
- **Definition of done**: Sandboxes tab lists all sandboxes (from `GET /api/genesis/sandboxes`). Each shows: ID, status, health, port, PID, createdAt, expiresAt. Has CLEAN UP button per sandbox. Has "Clean up expired" button.
- **Validation**: Create a sandbox via API, verify it appears. Clean it up, verify it's gone.
- **Status**: TODO

---

## PHASE 3 — AUTONOMOUS MISSION ENGINE

### FC-011 — Full mission lifecycle verification
- **Priority**: HIGH
- **Impact**: Need to verify the full pipeline (CEO → RESEARCH → ARCHITECT → ENGINEERING → QUALITY → SECURITY → DEPLOYMENT → GROWTH) produces real artifacts at every step.
- **Owner**: QA_ENGINEER
- **Files**: `tests/agent-runtime/mission-lifecycle.test.ts` (new)
- **Definition of done**: Integration test that dispatches a simple goal ("build a hello world CLI"), waits for completion, verifies: ≥5 tasks created, ≥3 executions SUCCESS, ≥2 artifacts persisted, ≥1 BuildCheckpoint, ≥1 TestRun, episodic memories recorded.
- **Validation**: `bun test tests/agent-runtime/mission-lifecycle.test.ts` passes.
- **Status**: TODO

---

## PHASE 5 — REAL TOOL EXECUTION

### FC-012 — Tool execution verification suite
- **Priority**: MEDIUM
- **Impact**: Need to verify every tool operation works correctly with permissions, logs, errors.
- **Owner**: QA_ENGINEER
- **Files**: `tests/agent-runtime/tools-verification.test.ts` (new)
- **Definition of done**: Tests cover: every tool's every operation, permission denials, error cases (path escape, timeout, non-zero exit, missing module), log persistence to ToolCall table.
- **Validation**: `bun test tests/agent-runtime/tools-verification.test.ts` passes.
- **Status**: TODO

---

## PHASE 9 — SECURITY HARDENING

### FC-013 — Environment variable validation
- **Priority**: HIGH
- **Impact**: Server starts even if critical env vars are missing.
- **Owner**: SRE_ENGINEER
- **Files**: `src/lib/env.ts` (new), `src/app/api/health/route.ts` (new)
- **Definition of done**: `src/lib/env.ts` validates `DATABASE_URL` is set. `GET /api/health` returns `{ status: "ok" | "degraded", checks: { db, env } }`. Server logs warning on startup if `ZAI_API_KEY` is missing.
- **Validation**: Hit `/api/health`, verify real status.
- **Status**: TODO

---

## PHASE 10 — DEPLOYMENT READINESS

### FC-014 — Dockerfile + docker-compose
- **Priority**: HIGH
- **Impact**: Cannot deploy without containerization.
- **Owner**: SRE_ENGINEER
- **Files**: `Dockerfile`, `docker-compose.yml`, `.dockerignore`
- **Definition of done**: `docker build -t shadow-genesis .` succeeds. `docker-compose up` starts: Next.js app on 3000, activity-service on 3030, volume for SQLite. Health check passes.
- **Validation**: `docker build` succeeds, `docker-compose up` serves the app.
- **Status**: TODO

### FC-015 — Production build verification
- **Priority**: HIGH
- **Impact**: Need to verify `bun run build` produces a working production bundle.
- **Owner**: SRE_ENGINEER
- **Files**: (verification only)
- **Definition of done**: `bun run build` succeeds. `bun run start` serves the app. All API routes respond. Dashboard loads.
- **Validation**: Run build, start, hit endpoints.
- **Status**: TODO

### FC-016 — README with deployment instructions
- **Priority**: MEDIUM
- **Impact**: Users don't know how to run the app.
- **Owner**: PRODUCT_MANAGER
- **Files**: `README.md`
- **Definition of done**: README has: quickstart (bun install, db:push, bun run dev), environment variables documented (DATABASE_URL, ZAI_API_KEY optional), production deployment (Docker), architecture overview, API reference link.
- **Validation**: Follow README from scratch, verify app runs.
- **Status**: TODO

---

## PHASE 11 — FINAL QA GAUNTLET

### FC-017 — FINAL_READINESS_REPORT.md
- **Priority**: CRITICAL
- **Impact**: Final deliverable.
- **Owner**: QA_ENGINEER
- **Files**: `FINAL_READINESS_REPORT.md`
- **Definition of done**: Report includes: test results (unit/integration/e2e/build), passed/failed counts, remaining risks, deployment instructions, architecture map, known limitations.
- **Validation**: Report exists, is accurate, covers all phases.
- **Status**: TODO

---

## EXECUTION ORDER

```
FC-001 (replace fake activity service)
FC-003 (build V4 dashboard — biggest impact)
FC-004 (mission input)
FC-005 (live mission tracking)
FC-007 (agents tab)
FC-006 (decisions tab)
FC-008 (observability tab)
FC-009 (security tab)
FC-010 (sandboxes tab)
FC-013 (env validation)
FC-011 (mission lifecycle test)
FC-012 (tools verification test)
FC-014 (Docker)
FC-015 (prod build verification)
FC-016 (README)
FC-002 (seed data cleanup)
FC-017 (final readiness report)
```

This order front-loads user-facing impact: replace fake data, build the real UI, then verify + ship.
