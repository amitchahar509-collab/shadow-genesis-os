# Changelog

All notable changes to Shadow Genesis OS. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

Proprietary — private repository. No public distribution.

## [v10.1.0] — 2026-07-14

Application layer — a self-serve app so a non-technical operator can configure and run Genesis without the terminal. Additive only; no new business modules, no architecture changes.

### Added
- **Setup Wizard** (`/setup`) — 6-step guided setup (Welcome → Environment → Database → AI Providers → Verify → Launch) driven by real backend detection; can initialize the database (real `prisma db push`) and save provider keys from the browser.
- **Settings** (`/settings`) — grouped configuration for AI providers, deployment, action connectors, revenue, and enterprise options; secret values shown masked, saved changes take effect immediately in-process (no restart), persisted to a git-ignored local file.
- **Real readiness detection** (`/api/genesis/setup`, `/api/genesis/settings`) — runtime, database, AI-provider, Docker, and connector status with repair hints, reusing the existing health functions (no duplication). Only the database is a hard requirement; AI providers and Docker are optional and never block.
- **Operator config store** (`app-config`) — allowlisted keys only (arbitrary env injection rejected); startup instrumentation applies saved config to the environment (an already-set env var always wins).
- **One-command install** — `docker compose up` builds the image, initializes the database on a persistent volume, and serves the Wizard at `http://localhost:3000/setup`.
- Setup/Settings navigation links in the dashboard header.

### Fixed
- `docker-compose.yml` healthcheck used `curl`, which the slim runtime image does not include — replaced with the `bun`-based check (same fix previously applied to the Dockerfile), so containers report health correctly.

### Security
- Operator secrets are stored in a git-ignored file, never returned raw (masked previews only), and settings mutations are ADMIN-gated.

### Verification
- 377 tests pass on both the committed and a fresh database; TypeScript 0 errors; ESLint 0 errors.
- `next build` compiles all 84 pages (incl. `/setup`, `/settings`); CI `verify` + `docker` jobs green on `8f7899e` — the production image builds with the new pages.

### Not included (honest boundary)
- A code-signed native desktop installer (Electron `.exe`/`.dmg`) is **not** part of this release — it requires a packaging/signing pipeline not available in the build environment and was not fabricated. `docker compose up` is the verified one-command install.

## [v10.0.1] — 2026-07-14

### Security
- **Least-privilege GitHub Actions permissions.** Scoped the `GITHUB_TOKEN` for every CI job to the minimum required (defense-in-depth):
  - `verify` → `contents: read`
  - `docker` → `contents: read` + `actions: write` (the `actions: write` scope is required by the GHA build cache `cache-to/from: type=gha`; verified as the only extra scope needed)
- No functionality or CI-behavior change — the diff is only the two `permissions:` blocks. Both CI jobs (`verify`, `docker`) confirmed green on `3d1ce55`.

## [v10.0.0] — 2026-07-14

Final Execution Layer. Completes the V10 program: 12 additive modules over the existing agent runtime, each built, tested, and verified against real data.

### Added
- **Real Internet Intelligence** — live World Scanner connectors (Hacker News, Reddit, GitHub Issues, StackOverflow, Google News, RSS, App Store reviews); honest `KEY_REQUIRED`/`UNAVAILABLE` tiers.
- **Autonomous Customer Acquisition** — real lead discovery, ICP + explainable matching, approval-gated outreach drafts, CRM, reply → reality-feedback loop.
- **Revenue Execution** — key-gated Stripe/Lemon Squeezy/Polar/Paddle sync; unit economics (MRR/ARR/CAC/LTV/churn) from real rows, `UNKNOWN` otherwise.
- **Deployment Cloud** — key-gated Vercel/Cloudflare/Railway/Render/Docker connectors; approval-gated deploys, real health checks, rollback.
- **Enterprise Observability** — Prometheus exposition endpoint, OTLP traces, latency/cost analytics, key-gated Sentry + OTLP exporters, Grafana dashboard JSON.
- **Enterprise Security** — secret detection + log redaction, prompt-injection firewall, CycloneDX + SPDX SBOM + dependency audit, sandbox command guard, security-event timeline.
- **Customer Success** — real product-event + support-ticket ledgers, drop-off funnel, satisfaction, tickets → improvement tasks.
- **Economic Brain** — real burn (from the LLM cost ledger), runway, profit/margins, ROI; `SIMULATION`-labeled forecasts.
- **Company OS** — per-company operating view aggregating each module's real data by `companyKey`.
- **Real Action Connectors** — 14 official-API connectors (GitHub, GitLab, Slack, Discord, Notion, Linear, Jira, HubSpot, Gmail, Google Calendar, Google Sheets, webhook, Zapier, n8n); every external mutation approval-gated, idempotent, delivery-verified; `UNCONFIGURED` without credentials.
- **Enterprise Hardening** — RBAC matrix, tenant-isolation verifier, org policies/quotas, backup manager (`UNCONFIGURED` without storage), key rotation, approval-gated GDPR export/delete, compliance-readiness reports (SOC2/ISO 27001/GDPR/HIPAA — verified controls only; no certification claimed).
- **Performance & Scale** — multi-level cache (deterministic outputs only), dependency-aware parallel scheduler, durable priority queue, token/model optimization, measured benchmark engine.

### Verification
- 370 tests pass on both the committed and a fresh database.
- TypeScript 0 errors; ESLint 0 errors.
- `next build` compiles; production Docker image builds green in CI (`verify` + `docker` jobs).

### Notes
- Every output is labeled `REAL` / `SIMULATION` / `HEURISTIC` / `ESTIMATED` / `UNKNOWN`. Connectors report `VERIFIED` or `UNCONFIGURED`; figures with no real data read `$0`/`UNKNOWN` by design.
- Deploy requires `DATABASE_URL`. Optional operator config (honestly `UNCONFIGURED` until set): `GENESIS_DB_ENCRYPTION_KEY`, `GENESIS_BACKUP_TARGET`, provider API keys, `GENESIS_AUTH_REQUIRED=1`.

[v10.1.0]: https://github.com/amitchahar509-collab/shadow-genesis-os/tree/v10.1.0
[v10.0.1]: https://github.com/amitchahar509-collab/shadow-genesis-os/tree/v10.0.1
[v10.0.0]: https://github.com/amitchahar509-collab/shadow-genesis-os/tree/v10.0.0
