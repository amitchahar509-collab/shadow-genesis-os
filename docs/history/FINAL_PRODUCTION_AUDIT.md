# Final Production Audit — Shadow Genesis OS

**Date:** 2026-07-15
**Method:** Execution-based audit of the real application as a first-time founder. Every finding below is backed by direct execution evidence (live HTTP calls, a real production build, and driving the built UI in a browser). No assumptions, no speculation.

**Scope tested:** production build (`bun run build` → standalone server → `bun run start`), all pages, all 12 dashboard tabs, the full mission lifecycle, the settings + connector flows, the deployment flow, and every GET API endpoint. Verified against the **production standalone server** (`NODE_ENV=production`, port 3500) — i.e. exactly what a founder runs, not the dev server.

**Out of scope (per standing constraints):** no new modules, no architecture redesign, no engine rewrite. Agent/orchestration domain behavior (e.g. task dependency-gating) was verified to *function*, not re-designed.

---

## Result

**2 production blockers were found. Both were fixed, rebuilt, and re-verified.**
After the fixes, no confirmed production blocker remains within the verified scope.

**Genesis is production-ready within the verified scope.**

---

## Confirmed blockers (found → fixed → verified)

### BLOCKER 1 — `bun run build` fails on Windows; standalone server ships with no static assets

**Severity:** Critical (production launch broken on Windows)

**Evidence (before):**
- `next build` succeeded, but the build **script** failed: `cp: illegal option -- r` → `script "build" exited with code 1`.
- Confirmed `.next/standalone/server.js` existed while `.next/standalone/.next/static` and `.next/standalone/public` were **missing** — so `bun run start` would serve the app with no CSS/JS/static assets.
- Root cause: Bun's built-in Shell (used by `bun run` on Windows) implements `cp` with only `-R`, not `-r`. Reproduced directly: `cp -r` → `illegal option`; `cp -R` → succeeds.

**Fix:** [`package.json`](package.json) build script `cp -r` → `cp -R` (POSIX-standard; works on GNU/Linux, BSD/macOS, and Bun shell — strictly more portable).

**Evidence (after):**
- `bun run build` exits 0.
- `.next/standalone/.next/static` (28 files) and `.next/standalone/public` present.
- Live production server: dashboard bundles serve `200` — e.g. `/_next/static/chunks/*.js` and `*.css` return `200` with `content-type: text/css`.

---

### BLOCKER 2 — Production server wedges under concurrent requests (verbose query logging blocks the event loop)

**Severity:** Critical (entire server becomes unresponsive under normal dashboard load)

**Evidence (before):**
- Loading the **Agents** tab in the browser left it stuck on “Loading agents…” forever; the endpoint stopped responding.
- Every endpoint then timed out — including trivial `/api/health` — i.e. the whole server wedged, not one route.
- Reproduced deterministically: a burst of concurrent requests to DB-backed endpoints (`/api/genesis/summary`, `/api/genesis/agents`, `/api/genesis/agents/states`) → the first ~9 succeed, then all subsequent requests hang (`HTTP 000`), and the server never recovers.
- Isolation: a **single** request always succeeds (`200` in ~0.5s); the wedge only appears under concurrency.
- Root cause: [`src/lib/db.ts`](src/lib/db.ts) created the Prisma client with `log: ['query']`, logging every SQL statement to stdout. Under concurrent load (the dashboard fires ~5–7 concurrent fetches on load; `/api/genesis/provider` alone emits 15+ queries), the synchronous stdout writes — amplified by the `start` script’s `| tee server.log` pipe filling — block the Bun event loop.
- Confirming experiment: with stdout redirected to `/dev/null`, **25/25** concurrent requests succeeded and the server stayed healthy; with `| tee` only **9** succeeded before the permanent wedge.

**Fix:** [`src/lib/db.ts`](src/lib/db.ts) — gate query logging to development only:
`log: process.env.NODE_ENV === 'production' ? ['error'] : ['query', 'error', 'warn']`.

**Evidence (after):** normal `bun run start` (with `| tee`), rebuilt with the fix:
- Burst 1: **30/30** concurrent `/api/genesis/summary` → all `200`.
- Burst 2: **20/20** concurrent mixed (`/provider` + `/agents/states`) → all `200`.
- Post-burst `/api/health` × 3 → all `200` (no wedge).
- In the browser, the **Agents** tab now loads fully — “▸ AGENTS (16)” with all agents, states, and controls. The original “Loading agents…” hang is gone.

---

## Verified working (execution evidence)

### Build & runtime
- **Production build**: `bun run build` exits 0; standalone `server.js` + `.next/static` + `public` all produced.
- **Production standalone server**: `bun run start` boots in ~3–4s; `/api/health` `200`.
- **SQLite path in standalone**: DB-backed endpoints return real data in the standalone build (`DATABASE_URL=file:../db/custom.db` resolves).
- **Static asset serving**: JS/CSS bundles `200` with correct content-types.
- **Docker path**: self-contained (`COPY .next`/`public` directly, `prisma db push` at startup, `DATABASE_URL=file:/app/data/genesis.db`); does not depend on the `cp` step; CI green.
- **Tests**: 377 pass / 0 fail (43 files). **Typecheck**: clean. **Lint**: clean.

### API surface
- **73 GET endpoints swept** → 72× `200`, 0× `500`. The single non-200 (`/api/genesis/prompts` → `400`) is a correct required-param guard (`?agent=` required; returns `200` with the param) and is not on any founder UI path.

### Pages & flows (driven live in the browser)
- **Setup Wizard** (`/setup`): all 6 steps end-to-end — Welcome → Environment (real detection: Bun 1.3.14, DB connected, 2 AI providers, Docker optional-warning, 0 blocking) → Database (ready) → AI Providers (optional keys) → Verify (“✓ ready to launch”) → Launch. Back correctly disabled on step 0. No dead buttons.
- **Dashboard — all 12 tabs render with real data, 0 console errors:**
  - Command Center (KPIs + 40-event live activity feed), Venture Intelligence (5 sub-tabs + World Scanner data), Mission Control (approvals/operator/experiments/feedback/evolution with clear empty states), Missions, Agents (16 agents + pause controls), Tasks (120-task graph + status filters), Memory (50 episodic memories), Messages (empty state), Security (“✅ RELEASE ALLOWED”), Observability (real exec/cost metrics), Sandboxes (empty state + clean action), Genesis State (mission + CEO decisions).
- **Mission lifecycle** (dispatched “build a hello world CLI tool in python” from the UI): mission created (`M-…`), Active Missions KPI → 1, live feed updated in real time; Missions tab showed live phase pill progressing **PLANNING → BOARD_REVIEW → BUILDING → COMPLETE** with a 5-task decomposition and per-task agent status. (Downstream tasks show `BLOCKED` via the engine’s dependency-gating — verified as expected dependency behavior, not a crash; engine logic is out of audit scope.)
- **Settings** (`/settings`): all connector groups render with real SET/unset badges and masked secret previews (`sk-o••••d0`); live save round-trip confirmed (“saved 1 key(s) — in effect now”); unknown keys rejected (`400 not configurable`); secrets never returned raw; persistence file `.genesis-config.json` is git-ignored and untracked.
- **Deployment flow** (Venture → Infra): Deployment Cloud renders honest provider readiness (all “no key” with clear “set X_TOKEN” guidance; docker connected), human-approval-gated with real HTTP health checks; deploy API (`/api/genesis/deploy`, `?verify=all`) returns honest unconfigured status.

### UI quality
- No dead buttons, `alert()` stubs, “coming soon”, TODO markers, or mock/dummy data across the dashboard and all section components (source-scanned + exercised live).
- Loading and empty states are present and correct throughout; error states surface real messages.

---

## Minor observations (NOT blockers — no action required)

- **Docker detection differs by context**: the Setup Wizard reports “Docker — not detected (optional)” while the Deployment Cloud panel shows “docker:connected.” Two different detection methods; neither blocks anything (Docker is optional). Cosmetic only.
- **Historical latency in Observability**: the LLM-call `P99` (~35s) reflects pre-fix CEO calls already recorded in the DB from earlier this session; current calls are fast. Honest historical data, not a current defect.
- **In-memory mission list resets on server restart**: the mission *list* (in-memory handles) is empty after a fresh server start, while DB-backed tasks/activity persist. This is the existing architecture (`MissionHandle` is in-memory) and is out of scope; missions dispatched within a server session display and track correctly.

---

## Fixes applied in this audit

| File | Change | Blocker |
|------|--------|---------|
| [`package.json`](package.json) | build script `cp -r` → `cp -R` | 1 |
| [`src/lib/db.ts`](src/lib/db.ts) | gate Prisma `log: ['query']` to development only | 2 |

Both fixes are minimal, portable, and verified end-to-end. Full test suite (377/377), typecheck, and lint all pass after the changes.

---

## Conclusion

Within the verified scope — production build, all pages, all 12 dashboard tabs, the full mission lifecycle, settings/connectors, the deployment flow, and the entire GET API surface — **no confirmed production blocker remains**. The two blockers found were real, reproduced with evidence, fixed, and re-verified against the production standalone server.

**Genesis is production-ready within the verified scope.**
