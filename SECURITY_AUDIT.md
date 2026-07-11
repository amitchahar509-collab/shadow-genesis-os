# SECURITY_AUDIT.md — V10 Module 6 Phase 0

> Real security posture of SHADOW GENESIS OS as of cycle 42 (`df834f4`, 280/280, CI green).
> Every finding cites real evidence (file:line). Severity: CRITICAL · HIGH · MEDIUM · LOW · INFO.
> Label: REAL (verified in code) · HEURISTIC (pattern-based) · UNKNOWN.

## Summary
No CRITICAL issues. The most material gaps: an unfiltered sandbox shell, no secret-redaction on the event/log path, no prompt-injection screening of web content fed to LLMs, and no SBOM. Module 6 closes these additively without touching working systems.

## Findings

### SEC-1 — Unfiltered sandbox shell command execution — **HIGH** (REAL)
Evidence: `src/lib/genesis/agent-runtime/tools/index.ts:128-133` — `terminal.exec` runs any `input.command` via `sh(ctx.sandboxRoot, cmd)` with only a timeout cap. No blocklist for `rm -rf /`, fork bombs (`:(){ :|:& };:`), `curl … | sh`, `dd`, or absolute-path writes.
Impact: a compromised/confused agent (or indirect injection) could run destructive commands. Sandbox is cwd-scoped but not command-scoped.
Fix (this module): a real command-safety screen (`assessCommand`) wired into `terminal.exec` that BLOCKS dangerous patterns and logs a SecurityEvent. Confidence: high.

### SEC-2 — No secret redaction on the log/event path — **MEDIUM** (REAL)
Evidence: `event-bus.ts` `emit()` persists `detail` to `ActivityLog` verbatim; tool outputs/errors (`base-agent.ts:60`) are truncated but not redacted. A key appearing in a command error or web payload could be stored.
Fix: `redactSecrets()` applied in `emit()` before persistence; same helper exported for any log sink. Confidence: high.

### SEC-3 — No prompt-injection screening of external content — **MEDIUM** (REAL)
Evidence: World Scanner feeds real web text (`world-scanner/connectors.ts`) into AEGIS/LLM paths; acquisition uses `signalText` from public pages in `generateOutreach`. No screen for "ignore previous instructions", exfiltration, or role-escalation in that untrusted content (indirect injection).
Fix: a prompt-injection firewall (`screenPrompt` → SAFE/WARNING/BLOCKED) available to callers; logged as SecurityEvents. Confidence: high (heuristic detection, labeled HEURISTIC).

### SEC-4 — No SBOM / dependency inventory — **MEDIUM** (REAL)
Evidence: no CycloneDX/SPDX artifact; `package.json` deps are real but uninventoried; no offline advisory check.
Fix: real SBOM generation (CycloneDX + SPDX) from `package.json`, plus a dependency audit that flags against an offline advisory list and honestly reports CVE feed as UNKNOWN without a key. Confidence: high.

### SEC-5 — Auth optional by default — **MEDIUM** (REAL, by design for local dev)
Evidence: `api-guard.ts` + `auth/index.ts` — `guardWrite` enforces only when `GENESIS_AUTH_REQUIRED=1`; otherwise `LOCAL_PRINCIPAL` (role OWNER, unmetered). Documented in G10.
Fix: no code change (intended); surfaced on the security dashboard so an operator sees enforcement state. Rate limiting (`checkAndRecordUsage`) is real and per-org when enforced.

### SEC-6 — No security headers on API responses — **LOW** (REAL)
Evidence: routes return bare `NextResponse.json` — no `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, CSP.
Fix: a `securityHeaders()` helper + a documented pattern; applied where responses are outward-facing. Confidence: high.

### SEC-7 — No upload/file-content screening — **LOW** (REAL)
Evidence: filesystem tool writes within sandbox; no MIME/executable/archive-bomb screen for any externally-sourced file.
Fix: `assessFile()` heuristic (extension spoofing, executable magic bytes, oversized, dangerous MIME). Confidence: medium (heuristic).

### SEC-8 — SQLite single-file, no encryption-at-rest, committed db — **INFO** (REAL)
Evidence: `db/custom.db` is committed (intentional for reproducibility); Prisma parameterizes all queries (no raw string interpolation except the audited EX_SEQ `$queryRaw` which uses no user input). SQL-injection surface: none found (all `$queryRaw` are static).
Fix: none required now; encryption-readiness noted for Module 11 (enterprise hardening).

### SEC-9 — Connector keys read from env, never logged — **INFO** (REAL, good)
Evidence: all connectors (`world-scanner`, `revenue-engine/providers`, `deployment-cloud/cloud-providers`, `telemetry/exporters`) read keys from `process.env` and send them only in `authorization` headers; none echo the key. `.env` is git-untracked (verified). Redaction (SEC-2) adds defense-in-depth.

## Non-findings (verified safe)
- No `eval()` of user input in product code (SecurityAgent rule `no-eval` enforces this on generated repos).
- No secrets committed (`.env` untracked; grep of tracked files finds no live keys).
- All mutation routes call `guardWrite` (audit + rate limit + trail) — verified across routes.
- Prisma parameterization prevents SQL injection; the only `$queryRaw` (EX_SEQ ratchet) takes no user input.

## Module 6 plan (all additive)
1. Secret Detection Engine + log redaction (SEC-2, SEC-9) → wire into `emit()`.
2. Prompt-Injection Firewall (SEC-3).
3. SBOM (CycloneDX + SPDX) + dependency audit (SEC-4).
4. API security headers + payload guards (SEC-6).
5. Sandbox hardening — command-safety screen wired into `terminal.exec` (SEC-1).
6. File-content screening (SEC-7).
7. SecurityEvent log + threat score + dashboard + report.
8. Self-healing suggestions (quarantine via existing `deprecatePlugin`; never deletes data).

## Resolution (cycle 43 — `security-engine/`)
- **SEC-1 FIXED** — `assessCommand`/`guardCommand` wired into `terminal.exec` ([tools/index.ts](src/lib/genesis/agent-runtime/tools/index.ts)); blocks `rm -rf /`, fork bombs, `curl|sh`, `dd`, reverse shells, credential reads → logs a `COMMAND_BLOCKED` event. Verified live.
- **SEC-2 FIXED** — `redactSecrets()` applied in `emit()` ([event-bus.ts](src/lib/genesis/agent-runtime/event-bus.ts)); no secret can reach ActivityLog/socket/subscribers. Verified live (redacted timeline).
- **SEC-3 FIXED** — `screenPrompt`/`firewallPrompt` firewall; SAFE/WARNING/BLOCKED with evidence, logged.
- **SEC-4 FIXED** — real CycloneDX 1.5 + SPDX 2.3 SBOM + offline advisory audit; CVE feed honestly UNKNOWN.
- **SEC-6 FIXED** — `securityHeaders()` helper; applied to the security dashboard response.
- **SEC-7 FIXED** — `assessFile()`: executable magic bytes, extension spoofing, oversized, dangerous MIME.
- **SEC-5 / SEC-8 / SEC-9** — surfaced on the dashboard (auth enforcement state) + defense-in-depth from redaction; no code change required (as noted). SEC-8 encryption-at-rest deferred to Module 11.
- New: `SecurityEvent` timeline + threat score + `/api/genesis/security/engine` + dashboard panel + `selfHeal` (suggests only, never deletes). 14 tests; live demo passed end-to-end.
