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
