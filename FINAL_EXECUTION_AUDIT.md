# FINAL EXECUTION AUDIT — V10 Phase 0

> Honest reality inventory of SHADOW GENESIS OS as of cycle 36 (commit `a80db96`, 233/233 tests, CI green).
> Labels: **REAL** (live data/side effects) · **SIMULATION** · **HEURISTIC** · **COMPUTED** · **STUB** · **MISSING**.

## Area-by-area

### Agent runtime — IMPLEMENTED (REAL)
16 registered agents + TemplateAgent specialists (marketplace-gated, cycle 33). Sandboxed executions, artifacts w/ checksums, tool calls, memory, retries, persistent EX-id ratchet (cycle 34). Evolved prompts steer real calls; outcomes recorded per PromptVersion (cycle 32).

### Model router — IMPLEMENTED (REAL)
5 providers (anthropic/openrouter/gemini/ollama/zai), measured registry ranking (EWMA reliability, latency, duels), FREE_GENESIS_MODE default, Fallback 2.0 retry/backoff, per-seat boardroom brains, cost intelligence + daily budget guard (cycle 35), test-env network lock. Gemini free tier is the proven live path ($0; multiple real runs on record).

### Boardroom — IMPLEMENTED (REAL LLM when keys present, labeled HEURISTIC otherwise)
9 seats, sequential free-mode staggering; real debate on record (cycle 29: NO_GO 90% overturned heuristic GO 67%). Seat diversity currently limited by OpenRouter free-pool saturation (external).

### AEGIS truth engine / venture analyst / demand graph — IMPLEMENTED (COMPUTED/HEURISTIC, honestly labeled)
Claims + evidence with stances/weights; venture scoring; demand↔product-DNA matching with reality tables. LLM-augmented when available.

### World scanner — PARTIALLY IMPLEMENTED → **Module 1 target**
Real internal sources only: REALITY (deployed-product signals), MARKET_GAP (COMPUTED), FAILED_VENTURE (MEMORY). **No real internet connector exists.** "WEB_ENABLED" mode is label-only (provider-key presence), scans nothing external — misleading until Module 1 lands.
**BUG (found this audit): `promoteToOpportunity` mints `OPP-` ids via `count()+1` — the exact collision pattern eradicated everywhere else.**

### Marketplace (G11) — IMPLEMENTED (REAL stats)
AGENT/TOOL/WORKFLOW/SKILL kinds; trust from real usage; lifecycle (install/uninstall/deprecate) gates real execution; evolution auto-listing.

### Evolution — IMPLEMENTED (REAL outcomes)
Data-driven IMPROVE/RETIRE/CREATE_SPECIALIST/ROLLBACK_PROMPT (cycle 36 regression guardrail). Specialist templates runnable when installed.

### Builder — IMPLEMENTED (REAL, local)
Engineering agent scaffolds real repos (nextjs/node-api/node-cli/python), installs, builds, tests, repairs via LLM loop.

### Deployment — PARTIALLY IMPLEMENTED → **Module 4 target**
LOCAL deploys only: build detect, env validation, health check on localhost, rollback records, security-release blocking. **No cloud provider (Vercel/Cloudflare/Railway/Render/Docker) connector.**

### Auth (G10) — IMPLEMENTED, single-tenant
API keys, roles (VIEWER/MEMBER/ADMIN), per-org daily usage limits (429), audit log, guardWrite on all mutation routes; enforcement behind GENESIS_AUTH_REQUIRED. **RBAC granularity, tenant isolation, backups, encryption-at-rest: MISSING → Module 11.**

### Dashboard (G13) — IMPLEMENTED
HUD panels for pipeline, boardroom, marketplace, models, costs, evolution, approvals. Budget block + installed specialists exposed by API (cycles 33/35); panels read them where wired.

## Module gap map (V10)

| # | Module | Status |
|---|--------|--------|
| 1 | Real internet intelligence | **MISSING** — no external connector; pain-extraction exists only over internal signals |
| 2 | Autonomous customer acquisition | **DONE (cycle 39)** — real lead discovery (GitHub orgs/HN/PH), ICP generator, DNA→lead matching, outreach drafts (LLM+heuristic), approval-gated send (never auto), CRM (Lead/OutreachDraft/LeadInteraction), reply tracking → reality loop, customer intelligence → tasks, dashboard panel |
| 3 | Revenue execution | **DONE (cycle 40)** — key-gated Stripe/LemonSqueezy/Polar/Paddle sync (real subscriptions/charges → ledger, idempotent); unit economics (MRR/ARR/ARPU/churn/LTV/CAC/LTV:CAC) computed from REAL rows only, $0/UNKNOWN when no real revenue; marketing-spend→CAC; pricing experiments (reuse GrowthExperiment); revenue dashboard panel |
| 4 | Deployment cloud | **DONE (cycle 41)** — key-gated Vercel/Cloudflare/Railway/Render/Docker/GitHub/Supabase/Neon connectors (real read-only verify); deploy-config generation (vercel.json/render.yaml/Dockerfile/…); approval-gated deploy planning (never auto-publishes); REAL HTTP health monitoring; rollback to prior healthy deploy; dashboard panel. Local DeploymentAgent untouched |
| 5 | Enterprise observability | **DONE (cycle 42)** — real Prometheus exposition endpoint (/api/genesis/metrics/prometheus), OTLP traces assembled from the real execution→tool→llm hierarchy, key-gated Sentry + OTLP exporters, latency percentiles (p50/p95/p99), cost analytics, Grafana dashboard JSON, audit log surfaced; dashboard panel |
| 6 | Security | **DONE (cycle 43)** — secret detection + live log redaction, prompt-injection firewall, CycloneDX+SPDX SBOM + dependency audit, sandbox command-guard wired into terminal.exec, file screening, security headers, SecurityEvent timeline + threat score + dashboard, self-heal (suggest-only). See SECURITY_AUDIT.md |
| 7 | Customer success engine | MISSING for real users (customer SIMULATION is labeled and stays); no real behavior/tickets until a product has real users |
| 8 | Economic brain | PARTIAL — cost intelligence + budget guard + venture unit economics; burn/runway/forecasting MISSING |
| 9 | Company OS | PARTIAL — projects/tasks/knowledge/memory real; CRM/leads/support MISSING |
| 10 | Real action connectors | PARTIAL — approval-gated `api` tool (generic HTTP); named connectors (email/Slack/GitHub/Notion/…) MISSING |
| 11 | Enterprise hardening | PARTIAL — see Auth above |
| 12 | Performance | PARTIAL — registry caches, Fallback 2.0, importance routing, EX ratchet; queues/token-budgeting MISSING |

## Fake / stub inventory
- **No fabricated data found.** Customer sim = SIMULATION-labeled; benchmark heuristic mode reports 0 tokens; marketplace/evolution/router stats all from real rows. Fake-spend test residue was found and purged in cycle 35 (sources fixed).
- CustomTool rows have no executable body — honest stubs; execution gating documented (cycle 33).
- "WEB_ENABLED" scanner mode label — misleading (see above); Module 1 makes it real or renames it.

## Technical debt
- `count()+1` id mint in `promoteToOpportunity` (**fix now**); other id families (PLG-/VC-/RUN-/BM-/EVO-) use bounded max-scans — low exposure, ratchet pattern available (cycle 34).
- Windows-local env: Next dev under preview harness breaks via Downloads NTFS junction; standalone-build copy step EINVAL (CI/Linux unaffected).
- approvals.test external-POST case is real-network-dependent (one transient flake on record).
- OpenRouter credits/account mismatch (external, user-side): premium multi-brain + reliable :free quota blocked.

## Security notes
- `.env` untracked (verified); no secrets in repo; scaffolded apps write their own dev `.env` (template-local).
- Auth optional by default for local dev — enforcement flag documented; api tool requires approval for external calls.

## Performance notes
- SQLite single-writer: parallel agent bursts serialized at allocation (by design); free-tier RPM is the real throughput ceiling; suite ~75–150s.
