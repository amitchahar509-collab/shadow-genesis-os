# Changelog

All notable changes to Shadow Genesis OS. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

Proprietary — private repository. No public distribution.

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

[v10.0.1]: https://github.com/amitchahar509-collab/shadow-genesis-os/tree/v10.0.1
[v10.0.0]: https://github.com/amitchahar509-collab/shadow-genesis-os/tree/v10.0.0
