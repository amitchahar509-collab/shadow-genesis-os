# G6_ARENA_AUDIT — Agent Arena Competition Engine

> Phase 0 audit for V8 G6. Measured 2026-07-09. 16 agents, 56 models, 69 routes, 14 test files (111 tests green).

## Reusable parts (compose, don't rebuild)

- **VENTURE agent** — scores a strategy's business quality (7-dim VENTURE_SCORE, evidence-capped). Reuse to score each team's revenue/long-term.
- **CUSTOMER agent** — seeded, reproducible buy-rate + CUSTOMER_REALITY_SCORE per strategy. Reuse to test each team's customer response.
- **AEGIS** (`assertClaim`/`scoreEvidence`) — verify each team's market claim; real truthScore feeds "evidence quality".
- **Boardroom** (`conveneBoard`) — review the winning strategy (directive Phase 3).
- **Memory engine** — record winning patterns + failed strategies (learning loop → future G7 evolution).
- **Auth guard** — gate the heavy competition launch (ADMIN) like company-create.
- **Dashboard** HudPanel/Chip/GenesisProgress conventions + the Venture Intelligence tab.

## Missing components (this cycle builds)

- **ArenaCompetition + ArenaEntry** models (competition, per-team scored entries).
- **arena module**: 3 teams (ALPHA innovation / BETA reliability / GAMMA growth) each transform the same mission into a distinct *strategic bet* (transparent parameter transforms — genuinely different trade-offs, not fabricated data), scored by the real stack; a **Judge** that weights 7 directive dimensions and selects winner = argmax(totalScore) — never hardcoded.
- `/api/genesis/arena` (run / list) + an Arena dashboard panel.

## Integration points

- Team strategy → VENTURE + CUSTOMER + AEGIS (real scores per team).
- Judge dimensions ← those real outputs: evidence=truthScore, feasibility=f(difficulty), customerValue=customerReality, revenue=ventureScore, risk=f(difficulty,competition), speed=f(difficulty), longTerm=growthPotential.
- Winner → Boardroom review; winner/losers → memory (patterns for evolution).
- Launch gated by the G10 auth guard (ADMIN).

## Anti-faking guarantees (directive RULES)

- Winner = argmax of real weighted scores; asserted in tests (winner is always the top-scored entry, and different opportunities produce different winners → not hardcoded).
- No placeholder agents — teams reuse the real VENTURE/CUSTOMER agents on transformed inputs.
- Every entry carries data (venture/truth/customer scores), a per-dimension breakdown, a rank, and the judge's reason.
