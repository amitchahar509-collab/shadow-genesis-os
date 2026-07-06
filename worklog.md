# SHADOW GENESIS OS — Worklog

> Autonomous AI Company Operating System — handover & status document.

---
Task ID: 1
Agent: Z.ai Code (main)
Task: Build SHADOW GENESIS OS — an autonomous AI company operating system dashboard. Single `/` route, dark cyberpunk HUD aesthetic, 8 departments, task graph, memory architecture, operational loops, real-time activity feed, seeded autonomous-company state.

Work Log:
- Explored scaffold (Next.js 16, TS, Tailwind 4, shadcn/ui, Prisma/SQLite, socket.io installed).
- Authored full Prisma schema (`prisma/schema.prisma`): GenesisTask, MemoryEntry, Department, CeoDecision, ResearchReport, ActivityLog, SystemMetric, BuildCheckpoint, OperationalLoop, GenesisState. Ran `bun run db:push`.
- Built dark cyberpunk theme in `src/app/globals.css`: genesis-bg grid + radial glow, glass `.genesis-panel`, HUD corner brackets, scanlines, pulsing live-dot, neon glow text, marquee ticker, custom scrollbar, boot flicker.
- Updated `src/app/layout.tsx` (dark default, mono fonts, GENESIS metadata).
- Implemented seed module `src/lib/genesis/seed.ts` — idempotent, rich autonomous-company state: 8 departments, 25 tasks w/ dependencies, 12 memory entries (3 types), 8 operational loops, 6 CEO decisions, 6 research reports, 20 activity logs, 10 system metrics, 5 build checkpoints, genesis state K/V (mission, assets, risks, next actions).
- Built 12 API routes under `src/app/api/genesis/*` (seed, summary, tasks, departments, memory, decisions, research, activity, metrics, loops, checkpoints, state). Seeded via POST /api/genesis/seed.
- Built shared types `src/lib/genesis/types.ts` + HUD primitives `src/components/genesis/primitives.tsx` (HudPanel, Chip, LiveClock, UptimeCounter via useSyncExternalStore singleton store, GenesisProgress, KpiStat).
- Built live `ActivityFeed` (`activity-feed.tsx`): socket.io + 6s polling fallback, dedup via seen-set, auto-scroll.
- Built main `GenesisShell` (`genesis-shell.tsx`): sticky header (logo, status chips, KPIs, live clock, uptime), responsive sidebar nav (6 tabs, mobile toggle), sticky footer with DISCOVER→REPEAT marquee loop, boot screen, error screen.
- Built 6 section views: Command Center (mission, 6 KPIs, dept grid, live feed, throughput chart, loop health, next actions), Task Graph (filters + detail panel w/ dependencies/dependents), Departments (8 expandable cards w/ telemetry + owned tasks), Memory Banks (3 columns + search + add-memory modal w/ POST), Operational Loops (8 cards w/ pause/resume PATCH), Genesis State (mission, completed/missing systems, risks, next actions, CEO decisions, research reports, git checkpoints, episodic activity).
- Created WebSocket mini-service `mini-services/activity-service/` (port 3030, socket.io, emits simulated agent telemetry every 2.5–5s, persists to DB via POST /api/genesis/activity). Installed its own deps, started in background with `bun --hot`.
- Fixed two bugs during verification: (1) `require()` in client component → switched to ESM imports; (2) `useSyncExternalStore` getSnapshot returning `new Date()` (new ref each call) caused infinite loop → refactored to singleton cached store.
- Verified end-to-end with agent-browser: page renders (no console errors), all 6 tabs navigate, task filters work, memory write modal commits + new entry appears, loop pause/resume toggles, genesis state renders all panels, sticky footer confirmed at viewport bottom (atBottom:true), mobile layout (390x844) has header+footer+working nav toggle.
- `bun run lint` clean.

Stage Summary:
- **Status: COMPLETE & VERIFIED.** SHADOW GENESIS OS is live on `/` (port 3000) with the activity mini-service on port 3030.
- Single user-visible route `/` with 6 tabbed sections; 12 API routes; 1 socket.io mini-service.
- Aesthetic: dark cyberpunk HUD (emerald/cyan/amber/violet — no indigo/blue per rules), monospace data, glassmorphism, animated indicators, sticky footer with execution-loop ticker.
- Real-time: live activity feed via WebSocket (instant) + polling fallback (robust); simulated agents across all 8 departments emit realistic telemetry every few seconds and persist to DB.
- Data: 25 tasks, 8 departments, 12 memories, 8 loops, 6 decisions, 6 research reports, 10 metrics, 5 checkpoints — all seeded and queryable.
- Interactivity verified: tab nav, task filters + detail, memory add (full POST cycle), loop toggle (PATCH), responsive + mobile nav, sticky footer.

Unresolved issues or risks, next-phase priorities:
- Deployment loop is intentionally PAUSED in seed data (reflects last rollback) — not a bug, part of the narrative.
- Model cost & token figures are simulated (no real billing integration) — matches "missing systems" list.
- The activity mini-service must keep running (`mini-services/activity-service/`). If it stops, the feed falls back to 6s polling gracefully — no breakage, just less "live" feel.
- **Recommended next phase:** (1) add task-status advance controls (PATCH wired, UI buttons not yet exposed); (2) add a "Create Task" modal mirroring the memory modal; (3) add a real task-dependency graph visualization (SVG/D3) instead of list; (4) hook the model-orchestration loop to a real z-ai-web-dev-sdk LLM call for one agent decision per cycle; (5) add keyboard shortcuts (1-6 to switch tabs).

---
Task ID: 4
Agent: Z.ai Code (main) — V4 build loop
Task: Continue Shadow Genesis OS V4 — implement all 15 phases. No fake data. Every action changes real state. Every feature ships with tests.

Work Log:
- Phase 0: Extracted V2 tar. Audited state: 12 V2 API routes, 11 Prisma models, no agent-runtime.
- Phase 1 (Internet Operator): Built InternetAgent with audit logs + human approval gates for FORM_SUBMIT actions. BrowserSession model tracks sessions. 7 action types (NAVIGATE, EXTRACT, FORM_FILL, FORM_SUBMIT, CLICK, MONITOR, SEARCH).
- Phase 2 (Opportunity Discovery): Built OpportunityAgent. Scans markets/trends/problems via web search, structures via LLM, persists to Opportunity table. Builds OPPORTUNITY_GRAPH artifact.
- Phase 3 (Business Validation): Built BusinessValidationAgent. Computes BUSINESS_SCORE (demand/competition/timing/feasibility/monetization weighted). Returns BUILD/REVIEW/KILL recommendation. Kills weak ideas (status → KILLED).
- Phase 4 (Product Studio): scaffoldNextjs() generates full Next.js+Prisma+NextAuth+bcrypt+credentials provider app with login/signup/protected dashboard/API routes/middleware/tests.
- Phase 5 (Growth OS): GrowthAgent with LLM-assisted GTM plan (positioning + 3 channels + KPIs). GrowthExperiment + GrowthMetric models for tracking.
- Phase 6 (Revenue Intelligence): Built RevenueAgent. Designs pricing models (SUBSCRIPTION/FREEMIUM/USAGE/etc.), 5-month forecasts, cost analysis with break-even. RevenueModel + RevenueEvent tables.
- Phase 7 (Multi-Company): Company model + Project entity with type/priority/businessScore. Per-project isolation. 13 API routes for projects + companies.
- Phase 8 (Agent Evolution): AgentMetric table + computeAgentMetrics job. PromptVersion with versioning + rollback + success/fail tracking. ExecutionAnalysis auto-creates improvement tasks.
- Phase 9 (Memory Intelligence): Jaccard similarity in recall. similarMissions() for past-execution recall. failurePrevention() for tool+operation failure lookup. consolidate() for episodic→procedural SOPs. KnowledgeNode + KnowledgeEdge models.
- Phase 10 (Tool Ecosystem): 7 built-in tools with per-agent PERMISSIONS allowlist. CustomTool model for registration. canUseTool() enforced in invokeTool().
- Phase 11 (Production Ops): HealthMonitor with startMonitoring/stopMonitoring. diagnoseError categorizes PORT_CONFLICT/MISSING_ENV/SYNTAX_ERROR/OOM/TIMEOUT/MISSING_DEP. rollbackDeployment reverts to previous PASSED checkpoint + creates fix task for ENGINEERING.
- Phase 12 (Strategic CEO): CeoAgent with LLM-assisted decomposition (7-task pipeline) + rule-based fallback. CeoDecision model.
- Phase 13 (Reality Feedback): RealitySignal model (USER_FEEDBACK/ANALYTICS/MARKET_RESPONSE/PERFORMANCE/FAILURE) with sentiment + impact. /v4/reality API.
- Phase 14 (Self-Audit): SelfAudit model + 8 audit questions. /v4/self-audit API.
- Phase 15 (Final Autonomy): /v4/dispatch front-door ("Build my idea"). /v4/system-map shows 21 capabilities. Continuous improvement via analyzer → improvement tasks → orchestrator picks them up.

Cross-cutting:
- 26 Prisma models (V2 had 11)
- 13 executable agents (V2 had 0)
- 7 real tools with permission system
- 46 API routes (V2 had 12)
- 33 V4 tests passing
- tsc clean, eslint clean, Next.js build successful
- Live smoke test: ARCHITECT agent ran via POST /api/genesis/agents → EX-000007 SUCCESS, 8.1s, 5 files scaffolded, real git commit "chore: scaffold node-cli for notes-app", 2 artifacts persisted

Stage Summary:
- **Status: V4 COMPLETE.** All 15 phases implemented. Every phase has code + tests + API + DB persistence.
- The OS can take "Build my idea" via POST /api/genesis/v4/dispatch → CEO decomposes → 7-agent pipeline runs in background → real artifacts + tests + commits + deployment + monitoring → memory compounds → self-improvement creates tasks for next iteration.
- 33 tests passing. tsc + eslint + build all clean.
- Live data verified: real ARCHITECT execution produced real files + git commit.
