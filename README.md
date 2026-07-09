# SHADOW GENESIS OS

> Autonomous AI organization that researches, builds, deploys, and improves digital products.

Shadow Genesis OS is an autonomous AI company operating system. Give it a goal — "build a note-taking app" — and it autonomously researches the market, validates the business, designs the architecture, builds the product, tests it, security-scans it, deploys it, monitors it, and plans growth + revenue.

## Quickstart

```bash
# 1. Install dependencies
bun install

# 2. Set up the database
bun x prisma db push

# 3. (Optional) Set an LLM key for LLM-powered agents
# Without one, agents use rule-based fallbacks (still functional, less creative)
export ANTHROPIC_API_KEY=your-key-here   # preferred (Claude)
# or: export ZAI_API_KEY=your-key-here   # fallback provider

# 4. Start the dev server
bun run dev

# 5. In a separate terminal, start the activity service
cd mini-services/activity-service
bun run index.ts
```

Open `http://localhost:3000` to access the dashboard.

## Dashboard

The dashboard has 10 tabs:

| Tab | Description |
|---|---|
| **Command Center** | Mission input ("Build my idea"), KPIs, active missions, live activity feed |
| **Missions** | All dispatched missions with status + task results |
| **Agents** | 13 agents with live state (IDLE/EXECUTING/PAUSED) + pause/resume controls |
| **Tasks** | Task graph with status filters |
| **Memory** | Episodic/semantic/procedural memory bank with search |
| **Messages** | Agent-to-agent collaboration messages |
| **Security** | Security findings with release-check status + resolve actions |
| **Observability** | Agent performance metrics, cost tracking, recent errors |
| **Sandboxes** | Isolated execution environments with cleanup controls |
| **Genesis State** | CEO decisions, build checkpoints, system mission |

## Agents

13 autonomous agents, each with real tools, memory access, and self-improvement:

| Agent | Role |
|---|---|
| **CEO** | Strategic decomposition — goal → ordered task plan |
| **RESEARCH** | Web research, competitor analysis, report generation |
| **ARCHITECT** | Architecture design + repository scaffolding |
| **ENGINEERING** | End-to-end build: scaffold → install → test → repair → commit |
| **DESIGN** | Design system: palette, tokens, components |
| **GROWTH** | GTM strategy, channels, KPIs |
| **QUALITY** | Test generation, security scan, bug detection, repair |
| **DEPLOYMENT** | Build detection, env validation, deploy, health monitor, rollback |
| **SECURITY** | Continuous security scanning + release blocking |
| **OPPORTUNITY** | Market opportunity discovery → OPPORTUNITY_GRAPH |
| **BUSINESS_VALIDATION** | BUSINESS_SCORE with BUILD/REVIEW/KILL recommendation |
| **REVENUE** | Pricing models, forecasts, break-even analysis |
| **INTERNET** | Browser automation with audit logs + human approval gates |

## API

56 API routes under `/api/genesis/*`. Key endpoints:

```bash
# Dispatch a mission ("Build my idea")
curl -X POST http://localhost:3000/api/genesis/v4/dispatch \
  -H "Content-Type: application/json" \
  -d '{"goal":"build a todo app","background":true}'

# List agents
curl http://localhost:3000/api/genesis/agents

# Convene the AI Boardroom on a decision (nine executive seats debate → GO/CONDITIONAL/NO_GO)
curl -X POST http://localhost:3000/api/genesis/boardroom \
  -H "Content-Type: application/json" \
  -d '{"question":"Should we build a Notion competitor?","context":{"confidence":70,"potentialValue":8,"difficulty":6,"competition":8}}'

# List recent board decisions (with each seat's argument)
curl http://localhost:3000/api/genesis/boardroom

# Judge an opportunity like a VC (VENTURE_SCORE + INVEST/WATCH/PASS; feeds the board)
curl -X POST http://localhost:3000/api/genesis/venture \
  -H "Content-Type: application/json" \
  -d '{"goal":"AI meeting notes for lawyers","context":{"potentialValue":8,"difficulty":5,"competition":6}}'

# AEGIS Truth Engine — assert a claim with evidence (no evidence ⇒ UNSUPPORTED, never high confidence)
curl -X POST http://localhost:3000/api/genesis/aegis \
  -H "Content-Type: application/json" \
  -d '{"statement":"Demand for X is rising","evidence":[{"stance":"SUPPORT","summary":"survey","source":"http://a","sourceType":"WEB","weight":0.8}]}'

# Digital Customer Simulation — simulate virtual buyers → CUSTOMER_REALITY_SCORE (labelled SIMULATION, not real users)
curl -X POST http://localhost:3000/api/genesis/customers \
  -H "Content-Type: application/json" \
  -d '{"goal":"AI invoicing for freelancers","context":{"potentialValue":8,"competition":4,"personaCount":300,"price":25}}'

# CREATE A COMPANY — no idea required. Full autonomous pipeline:
# DISCOVER → AEGIS evidence → VENTURE score → CUSTOMER simulation → BOARD debate → build gate
curl -X POST http://localhost:3000/api/genesis/company \
  -H "Content-Type: application/json" \
  -d '{}'   # optionally: {"focus":"developer tools","build":false}
curl http://localhost:3000/api/genesis/company   # poll run status

# Approval Control Center — external actions (emails, posts, payments, HTTP writes) block until a human approves
curl http://localhost:3000/api/genesis/approvals?status=PENDING   # the human queue
curl -X PATCH http://localhost:3000/api/genesis/approvals \
  -H "Content-Type: application/json" \
  -d '{"requestId":"APR-000001","approve":true,"decidedBy":"you@example.com"}'   # approvals are single-use

# Long-Horizon Operator — operate companies for 30/60/90 days (tick-driven; point a cron at tickAll)
curl -X POST http://localhost:3000/api/genesis/operator \
  -H "Content-Type: application/json" \
  -d '{"goal":"Operate: my product","horizonDays":30}'
curl -X PATCH http://localhost:3000/api/genesis/operator \
  -H "Content-Type: application/json" \
  -d '{"action":"tickAll"}'   # runs due DAILY/WEEKLY/MONTHLY reviews on every active mission

# Acquisition Engine — one growth-experiment cycle (PRICING → AUDIENCE → CHANNEL ladder)
# Measurements are SIMULATION-labelled; CHANNEL experiments block on human approval and never fabricate results
curl -X POST http://localhost:3000/api/genesis/acquisition \
  -H "Content-Type: application/json" \
  -d '{"opportunityId":"OPP-000001"}'
curl "http://localhost:3000/api/genesis/acquisition?subject=OPP-000001"   # experiment memory + learnings

# Benchmark Arena — Genesis scores itself (discrimination: does it rank strong>weak, refuse unsupported confidence?)
curl -X POST http://localhost:3000/api/genesis/benchmark \
  -H "Content-Type: application/json" \
  -d '{"suite":"intelligence","background":false}'   # → autonomyScore + per-capability pass/score
curl "http://localhost:3000/api/genesis/benchmark?trend=1"   # score trend over time

# Reality Feedback — deployed products report REAL telemetry; Genesis reacts (tasks/metrics/closed experiments)
curl -X POST http://localhost:3000/api/genesis/feedback \
  -H "Content-Type: application/json" \
  -d '{"kind":"ERROR","productKey":"co-myapp","source":"sentry","detail":"crash on export"}'   # → CRITICAL QUALITY task
# CONVERSION with a subject closes that opportunity's approved channel experiment with REAL data:
#   -d '{"kind":"CONVERSION","productKey":"co-myapp","source":"utm","detail":"reddit launch","subject":"OPP-000001","payload":{"conversions":37,"visitors":920}}'

# Auth (production) — set GENESIS_AUTH_REQUIRED=1, then provision once:
curl -X POST http://localhost:3000/api/genesis/auth \
  -H "Content-Type: application/json" \
  -d '{"action":"bootstrap","email":"you@example.com","orgName":"My Co"}'   # → OWNER apiKey (shown once)
# Protected mutations then need the key; reads stay open:
curl -X PATCH http://localhost:3000/api/genesis/operator \
  -H "Authorization: Bearer gk_..." -H "Content-Type: application/json" -d '{"action":"tickAll"}'

# Check orchestrator status
curl http://localhost:3000/api/genesis/orchestrator/status

# Health check
curl http://localhost:3000/api/health
```

## Tools

7 sandboxed tools with per-agent permissions:

- **filesystem** — read, write, list, mkdir, rm, stat, exists (path-escape rejected)
- **terminal** — exec, which (timeout-capped, output-capped)
- **code** — eval (in node:vm with NO process/require/fs), run
- **api** — outbound HTTP requests
- **browser** — web search + page reader via z-ai-web-dev-sdk
- **git** — init, status, add, commit, log
- **package** — install, add, run (via bun/npm)

## Memory

Three memory types with semantic similarity search:

- **Episodic** — events, attempts, failures, successes
- **Semantic** — facts, architecture, knowledge
- **Procedural** — best workflows, engineering patterns, SOPs

Every execution records episodic memory. The `consolidate()` function groups episodic memories by tag and creates procedural SOPs when patterns repeat.

## Self-Improvement

After every execution, `analyzeExecution()` runs to determine:
- What worked (fast successful tool calls)
- What failed (errors, retries)
- What wasted time (slow tool calls)

If patterns are detected, improvement tasks are automatically created for the relevant agent.

Prompt versioning tracks which system prompts produce better outcomes. Roll back to previous versions via the API.

## Production Deployment

### Docker

```bash
# Build and run
docker-compose up

# Or build manually
docker build -t shadow-genesis .
docker run -p 3000:3000 -p 3030:3030 shadow-genesis
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | SQLite path or Postgres URL |
| `ANTHROPIC_API_KEY` | No | Preferred LLM provider (Claude) — enables LLM-powered agents |
| `GENESIS_LLM_MODEL` | No | Anthropic model id override (default `claude-sonnet-5`) |
| `ZAI_API_KEY` | No | Fallback LLM provider (z-ai) |
| `NEXTAUTH_SECRET` | No | Required for user auth in production |
| `NEXTAUTH_URL` | No | Public URL of the deployment |

## Development

```bash
# Run tests
bun test

# Type check
bun x tsc --noEmit

# Lint
bun x eslint src/ tests/

# Build
bun run build
```

## Architecture

```
src/
├── app/
│   ├── api/genesis/          # 56 API routes
│   ├── page.tsx              # Dashboard entry
│   └── globals.css           # V4 cyberpunk theme
├── components/genesis/
│   ├── genesis-dashboard.tsx # 10-tab V4 dashboard
│   ├── activity-feed.tsx     # Live WebSocket feed
│   └── primitives.tsx        # HUD components
└── lib/genesis/agent-runtime/
    ├── agents/               # 13 agents + scaffolds
    ├── tools/                # 7 sandboxed tools
    ├── memory/               # Memory engine
    ├── orchestrator/         # Task pipeline
    ├── collab/               # Message bus + state + graph
    ├── improvement/          # Analyzer + prompt versioning
    ├── observability/        # Metrics + cost
    ├── sandbox/              # Sandbox manager
    ├── deployment/           # Health monitor
    └── event-bus.ts          # Real-time events

mini-services/
└── activity-service/         # Socket.io real-event broadcaster (port 3030)

prisma/
└── schema.prisma             # 39 models
```

## License

MIT
