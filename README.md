# SHADOW GENESIS OS

> Autonomous AI organization that researches, builds, deploys, and improves digital products.

Shadow Genesis OS is an autonomous AI company operating system. Give it a goal — "build a note-taking app" — and it autonomously researches the market, validates the business, designs the architecture, builds the product, tests it, security-scans it, deploys it, monitors it, and plans growth + revenue.

## Quickstart

```bash
# 1. Install dependencies
bun install

# 2. Set up the database
bun x prisma db push

# 3. (Optional) Set ZAI_API_KEY for LLM-powered agents
# Without it, agents use rule-based fallbacks (still functional, less creative)
export ZAI_API_KEY=your-key-here

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
| `ZAI_API_KEY` | No | Enables LLM-powered agents |
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
