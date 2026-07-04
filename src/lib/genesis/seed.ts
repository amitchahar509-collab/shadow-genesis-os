import { db } from "@/lib/db";

/**
 * Seeds the SHADOW GENESIS OS database with a complete autonomous AI company
 * operating state. Idempotent — safe to call repeatedly.
 */
export async function seedGenesis() {
  // ---------- GENESIS STATE (K/V) ----------
  const stateKv: Record<string, string> = {
    mission:
      "Transform the human vision of an autonomous AI company into a real, working, self-improving operating system that ships software continuously.",
    vision_source: "USER_INPUT",
    boot_epoch: new Date(Date.now() - 1000 * 60 * 60 * 26.4).toISOString(),
    phase: "BUILD",
    cycle: "7",
    uptime_seconds: "95042",
    active_agents: "14",
    model_cost_today: "12.8470",
    tokens_today: "4823109",
    products_shipped: "1",
    completed_systems: JSON.stringify([
      "Genesis State Tracker",
      "Task Graph Engine",
      "Department Orchestration Layer",
      "Memory Architecture (Episodic / Semantic / Procedural)",
      "Self-Correction Loop",
      "Git Checkpoint System",
      "Security Scanner",
      "Model Orchestration Router",
      "Deployment Pipeline",
      "Feedback Learning Loop",
      "Command Center Dashboard",
    ]),
    missing_systems: JSON.stringify([
      "Multi-tenant auth & RBAC",
      "Real production deployment target (currently sandbox)",
      "Revenue / billing integration",
      "External user feedback ingestion pipeline",
      "Long-term vector memory store",
    ]),
    technical_risks: JSON.stringify([
      {
        risk: "Model cost scaling — token spend growing 18% per cycle",
        severity: "HIGH",
        mitigation: "Route more tasks to cheap models via orchestrator",
      },
      {
        risk: "Self-correction loop occasionally thrashes on ambiguous test failures",
        severity: "MEDIUM",
        mitigation: "Add confidence threshold before fixer agent retry",
      },
      {
        risk: "Single SQLite database — no HA / replication",
        severity: "MEDIUM",
        mitigation: "Documented; out of scope for MVP sandbox",
      },
    ]),
    next_actions: JSON.stringify([
      "Stabilize deployment loop after last rollback",
      "Add external user feedback webhook endpoint",
      "Promote 3 PENDING tasks to IN_PROGRESS based on dependency resolution",
      "Run full security scan on new API surface",
    ]),
  };

  for (const [key, value] of Object.entries(stateKv)) {
    await db.genesisState.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  // ---------- DEPARTMENTS ----------
  const departments = [
    {
      key: "ceo",
      name: "CEO Agent",
      mission: "Strategic decision system. Understand vision, define goals, prioritize execution, allocate agents, decide build order.",
      status: "ACTIVE",
      health: 98,
      activeAgents: 1,
      completedTasks: 18,
      pendingTasks: 2,
      load: 42,
      metrics: JSON.stringify({
        decisionsToday: 7,
        strategicAccuracy: 0.86,
        avgDecisionLatencyMs: 1240,
      }),
    },
    {
      key: "research",
      name: "Research Department",
      mission: "Find reality. Never assume. Research markets, competitors, users, technology, opportunities, risks. Every claim needs evidence.",
      status: "ACTIVE",
      health: 94,
      activeAgents: 2,
      completedTasks: 14,
      pendingTasks: 3,
      load: 61,
      metrics: JSON.stringify({
        reportsPublished: 6,
        avgConfidence: 0.74,
        sourcesCited: 142,
      }),
    },
    {
      key: "product",
      name: "Product Architect",
      mission: "Convert research into product requirements, system architecture, user journeys, database schemas, API contracts.",
      status: "ACTIVE",
      health: 91,
      activeAgents: 2,
      completedTasks: 16,
      pendingTasks: 1,
      load: 55,
      metrics: JSON.stringify({
        blueprintsDrafted: 9,
        apiContracts: 23,
        schemas: 5,
      }),
    },
    {
      key: "engineering",
      name: "Engineering Department",
      mission: "Build real software. Loop: Understand → Implement → Run → Test → Fix → Repeat. Never leave broken builds.",
      status: "ACTIVE",
      health: 87,
      activeAgents: 4,
      completedTasks: 41,
      pendingTasks: 5,
      load: 78,
      metrics: JSON.stringify({
        commits: 312,
        buildPassRate: 0.94,
        avgCycleTimeH: 3.2,
      }),
    },
    {
      key: "ai_systems",
      name: "AI System Department",
      mission: "Create agent systems, AI workflows, model routing, memory, tools, automation pipelines. Optimize accuracy, cost, speed.",
      status: "ACTIVE",
      health: 96,
      activeAgents: 3,
      completedTasks: 22,
      pendingTasks: 2,
      load: 64,
      metrics: JSON.stringify({
        agentsOnline: 14,
        toolCallsToday: 8421,
        modelRoutingSavings: 0.34,
      }),
    },
    {
      key: "design",
      name: "Design Department",
      mission: "Create UI, UX, design system, brand identity, components. Validate clarity, speed, user experience.",
      status: "ACTIVE",
      health: 93,
      activeAgents: 1,
      completedTasks: 19,
      pendingTasks: 2,
      load: 48,
      metrics: JSON.stringify({
        componentsShipped: 47,
        designSystemCoverage: 0.91,
        avgFcpMs: 720,
      }),
    },
    {
      key: "growth",
      name: "Growth Department",
      mission: "Create marketing systems, SEO, content, launch strategy, distribution, growth experiments. Measure users, retention, conversion.",
      status: "IDLE",
      health: 82,
      activeAgents: 1,
      completedTasks: 9,
      pendingTasks: 4,
      load: 22,
      metrics: JSON.stringify({
        experiments: 5,
        conversionRate: 0.038,
        organicUsers: 1284,
      }),
    },
    {
      key: "quality",
      name: "Quality Department",
      mission: "Attack everything. Find bugs, bad logic, security issues, performance problems, weak UX. Nothing ships without validation.",
      status: "ACTIVE",
      health: 90,
      activeAgents: 2,
      completedTasks: 28,
      pendingTasks: 3,
      load: 71,
      metrics: JSON.stringify({
        bugsCaught: 64,
        securityFindings: 7,
        testCoverage: 0.81,
      }),
    },
  ];
  for (const d of departments) {
    await db.department.upsert({
      where: { key: d.key },
      update: {},
      create: d,
    });
  }

  // ---------- OPERATIONAL LOOPS ----------
  const now = Date.now();
  const loops = [
    {
      key: "self_correction",
      name: "Self-Correction Engine",
      description: "Planner → Builder → Tester → Error Detector → Fixer → Tester. On failure: root cause, never random patch.",
      status: "RUNNING",
      cycleCount: 184,
      lastRunAt: new Date(now - 1000 * 60 * 4).toISOString(),
      interval: "continuous",
      healthScore: 92,
      detail: "Last fix: corrected Prisma relation mismatch in 1 cycle.",
    },
    {
      key: "sandbox",
      name: "Sandbox Execution Loop",
      description: "Before trusting code: run it, test it, observe output. Track errors, logs, performance, security.",
      status: "RUNNING",
      cycleCount: 311,
      lastRunAt: new Date(now - 1000 * 60 * 2).toISOString(),
      interval: "on-commit",
      healthScore: 95,
      detail: "Sandbox clean. 0 escaped processes.",
    },
    {
      key: "git",
      name: "Git Checkpoint Loop",
      description: "Before major changes: create checkpoint. After successful feature: commit. Document what/why/impact.",
      status: "RUNNING",
      cycleCount: 96,
      lastRunAt: new Date(now - 1000 * 60 * 18).toISOString(),
      interval: "per-feature",
      healthScore: 100,
      detail: "Working tree clean. v0.7.3 tagged.",
    },
    {
      key: "security",
      name: "Security Loop",
      description: "Continuously scan secrets, authentication, authorization, dependencies, inputs, APIs, data access. Security is never optional.",
      status: "RUNNING",
      cycleCount: 142,
      lastRunAt: new Date(now - 1000 * 60 * 11).toISOString(),
      interval: "300s",
      healthScore: 88,
      detail: "2 medium findings pending remediation in /api routes.",
    },
    {
      key: "model_orchestration",
      name: "AI Model Orchestration",
      description: "Use models intelligently. Cheap models for simple tasks, advanced for architecture/reasoning. Optimize quality, cost, speed.",
      status: "RUNNING",
      cycleCount: 2048,
      lastRunAt: new Date(now - 1000 * 30).toISOString(),
      interval: "continuous",
      healthScore: 97,
      detail: "34% cost reduction vs single-model baseline this cycle.",
    },
    {
      key: "deployment",
      name: "Deployment Loop",
      description: "Automatically manage build, environment, deployment, monitoring, errors, rollback. Production must be real.",
      status: "PAUSED",
      cycleCount: 38,
      lastRunAt: new Date(now - 1000 * 60 * 60 * 2).toISOString(),
      interval: "on-release",
      healthScore: 74,
      detail: "Paused after last rollback. Awaiting Quality sign-off.",
    },
    {
      key: "feedback",
      name: "Feedback Learning Loop",
      description: "Collect user behavior, failures, metrics, feedback. Convert learning into better products, decisions, systems.",
      status: "RUNNING",
      cycleCount: 57,
      lastRunAt: new Date(now - 1000 * 60 * 14).toISOString(),
      interval: "600s",
      healthScore: 84,
      detail: "Ingesting 3 feedback channels. 1 channel degraded.",
    },
    {
      key: "learning",
      name: "Memory Consolidation Loop",
      description: "Promote episodic → semantic → procedural memory. Never repeat solved mistakes.",
      status: "RUNNING",
      cycleCount: 73,
      lastRunAt: new Date(now - 1000 * 60 * 9).toISOString(),
      interval: "900s",
      healthScore: 90,
      detail: "Last consolidation promoted 4 procedural SOPs.",
    },
  ];
  for (const l of loops) {
    await db.operationalLoop.upsert({
      where: { key: l.key },
      update: {},
      create: l,
    });
  }

  // ---------- TASKS ----------
  const tasks = [
    { taskId: "T-001", title: "Define Q3 product vision & north-star metric", description: "Synthesize user vision + research into a measurable north-star and quarterly OKRs.", ownerAgent: "CEO", department: "ceo", priority: "CRITICAL", status: "DONE", progress: 100, dependencies: "[]", expectedArtifact: "CEO_DECISIONS.md", validation: "Approved by stakeholders; metric instrumented", estimatedHours: 6, actualHours: 5 },
    { taskId: "T-002", title: "Allocate agents to highest-leverage bottleneck", description: "Reassign 2 growth agents to engineering to clear build backlog.", ownerAgent: "CEO", department: "ceo", priority: "HIGH", status: "DONE", progress: 100, dependencies: "[\"T-001\"]", expectedArtifact: "Allocation manifest", validation: "Agent capacity rebalanced", estimatedHours: 2, actualHours: 2 },
    { taskId: "T-017", title: "Decide build order for auth + billing", description: "Prioritize auth (dependency for billing) then billing MVP.", ownerAgent: "CEO", department: "ceo", priority: "HIGH", status: "IN_PROGRESS", progress: 40, dependencies: "[\"T-001\"]", expectedArtifact: "Build order decision", validation: "Engineering consumes decision", estimatedHours: 3, actualHours: 1 },
    { taskId: "T-003", title: "Market sizing for autonomous-agent OS category", description: "TAM/SAM/SOM with cited sources. Identify adjacent competitors.", ownerAgent: "RESEARCH", department: "research", priority: "HIGH", status: "DONE", progress: 100, dependencies: "[]", expectedArtifact: "RESEARCH_REPORT.md", validation: "Every claim has evidence link", estimatedHours: 8, actualHours: 9 },
    { taskId: "T-004", title: "User interview synthesis — 12 sessions", description: "Code qualitative feedback into themes. Output opportunity map.", ownerAgent: "RESEARCH", department: "research", priority: "HIGH", status: "REVIEW", progress: 85, dependencies: "[]", expectedArtifact: "Research synthesis doc", validation: "Themes validated by 2 researchers", estimatedHours: 10, actualHours: 11 },
    { taskId: "T-018", title: "Competitor teardown — 4 agent platforms", description: "Feature matrix + pricing + positioning gaps.", ownerAgent: "RESEARCH", department: "research", priority: "MEDIUM", status: "IN_PROGRESS", progress: 55, dependencies: "[\"T-003\"]", expectedArtifact: "Competitor matrix", validation: "Cross-checked against public docs", estimatedHours: 6, actualHours: 3 },
    { taskId: "T-005", title: "Author product blueprint v1", description: "Product requirements, system architecture, user journeys, DB schemas, API contracts.", ownerAgent: "PRODUCT", department: "product", priority: "CRITICAL", status: "DONE", progress: 100, dependencies: "[\"T-003\"]", expectedArtifact: "PRODUCT_BLUEPRINT.md", validation: "Engineering signed off", estimatedHours: 12, actualHours: 14 },
    { taskId: "T-006", title: "Define API contracts for task graph service", description: "REST + WS contracts for tasks CRUD, dependencies, activity feed.", ownerAgent: "PRODUCT", department: "product", priority: "HIGH", status: "DONE", progress: 100, dependencies: "[\"T-005\"]", expectedArtifact: "OpenAPI spec", validation: "Contract tests pass", estimatedHours: 5, actualHours: 4 },
    { taskId: "T-019", title: "Design RBAC schema for multi-tenant", description: "Roles, permissions, tenant isolation model.", ownerAgent: "PRODUCT", department: "product", priority: "MEDIUM", status: "BLOCKED", progress: 20, dependencies: "[\"T-017\"]", expectedArtifact: "RBAC schema", validation: "Security review", estimatedHours: 4, actualHours: 1 },
    { taskId: "T-007", title: "Implement Command Center dashboard", description: "KPI cards, department grid, live activity feed, metric charts.", ownerAgent: "ENGINEERING", department: "engineering", priority: "CRITICAL", status: "IN_PROGRESS", progress: 70, dependencies: "[\"T-006\"]", expectedArtifact: "Dashboard UI + API", validation: "Agent-browser smoke test", estimatedHours: 14, actualHours: 10 },
    { taskId: "T-008", title: "Build task graph API + persistence", description: "Prisma models, CRUD endpoints, dependency resolver.", ownerAgent: "ENGINEERING", department: "engineering", priority: "CRITICAL", status: "DONE", progress: 100, dependencies: "[\"T-006\"]", expectedArtifact: "API routes", validation: "All endpoints return 2xx", estimatedHours: 8, actualHours: 7 },
    { taskId: "T-009", title: "Wire WebSocket real-time activity service", description: "Mini-service emitting simulated agent activity events.", ownerAgent: "ENGINEERING", department: "engineering", priority: "HIGH", status: "IN_PROGRESS", progress: 45, dependencies: "[\"T-008\"]", expectedArtifact: "socket.io mini-service", validation: "Client receives events < 500ms", estimatedHours: 6, actualHours: 3 },
    { taskId: "T-020", title: "Implement memory bank CRUD + search", description: "Episodic/Semantic/Procedural entries with tag filter.", ownerAgent: "ENGINEERING", department: "engineering", priority: "HIGH", status: "IN_PROGRESS", progress: 60, dependencies: "[\"T-008\"]", expectedArtifact: "Memory API + UI", validation: "Search returns ranked results", estimatedHours: 5, actualHours: 3 },
    { taskId: "T-021", title: "Add operational loops status API", description: "Health, cycle count, last run for all 8 loops.", ownerAgent: "ENGINEERING", department: "engineering", priority: "MEDIUM", status: "PENDING", progress: 0, dependencies: "[\"T-008\"]", expectedArtifact: "Loops API", validation: "Status reflects DB", estimatedHours: 3, actualHours: 0 },
    { taskId: "T-010", title: "Build model orchestration router", description: "Route by task complexity to cheap/advanced models. Track cost.", ownerAgent: "AI_SYSTEMS", department: "ai_systems", priority: "HIGH", status: "DONE", progress: 100, dependencies: "[]", expectedArtifact: "Router module", validation: "34% cost reduction measured", estimatedHours: 10, actualHours: 11 },
    { taskId: "T-011", title: "Implement agent memory consolidation", description: "Episodic → semantic → procedural promotion pipeline.", ownerAgent: "AI_SYSTEMS", department: "ai_systems", priority: "HIGH", status: "IN_PROGRESS", progress: 65, dependencies: "[\"T-010\"]", expectedArtifact: "Consolidation job", validation: "No memory loss; SOPs promoted", estimatedHours: 8, actualHours: 5 },
    { taskId: "T-022", title: "Tool registry for agents", description: "Typed tool definitions + permission gating.", ownerAgent: "AI_SYSTEMS", department: "ai_systems", priority: "MEDIUM", status: "PENDING", progress: 0, dependencies: "[\"T-010\"]", expectedArtifact: "Tool registry", validation: "Agents can call tools safely", estimatedHours: 6, actualHours: 0 },
    { taskId: "T-012", title: "Establish design system tokens", description: "Color, type, spacing, motion tokens. Dark cyberpunk theme.", ownerAgent: "DESIGN", department: "design", priority: "HIGH", status: "DONE", progress: 100, dependencies: "[]", expectedArtifact: "Token spec + CSS vars", validation: "Tokens adopted across UI", estimatedHours: 6, actualHours: 5 },
    { taskId: "T-013", title: "Design HUD command center layout", description: "Header, sidebar, multi-panel grid, sticky footer.", ownerAgent: "DESIGN", department: "design", priority: "HIGH", status: "DONE", progress: 100, dependencies: "[\"T-012\"]", expectedArtifact: "Layout + component spec", validation: "UX review pass", estimatedHours: 5, actualHours: 5 },
    { taskId: "T-023", title: "Animated metric visualizations", description: "Recharts area/bar with glow, scanlines, pulsing indicators.", ownerAgent: "DESIGN", department: "design", priority: "MEDIUM", status: "IN_PROGRESS", progress: 50, dependencies: "[\"T-013\"]", expectedArtifact: "Chart components", validation: "60fps on target devices", estimatedHours: 4, actualHours: 2 },
    { taskId: "T-014", title: "Launch SEO content engine", description: "Programmatic landing pages + keyword clusters.", ownerAgent: "GROWTH", department: "growth", priority: "MEDIUM", status: "PENDING", progress: 0, dependencies: "[\"T-004\"]", expectedArtifact: "Content pipeline", validation: "Pages indexed; ranked", estimatedHours: 10, actualHours: 0 },
    { taskId: "T-024", title: "Set up analytics + retention funnel", description: "Event capture, funnel, cohort retention dashboard.", ownerAgent: "GROWTH", department: "growth", priority: "MEDIUM", status: "IN_PROGRESS", progress: 35, dependencies: "[]", expectedArtifact: "Analytics dashboard", validation: "Events flowing; cohorts compute", estimatedHours: 6, actualHours: 2 },
    { taskId: "T-015", title: "Security scan of new API surface", description: "Authn/authz, input validation, dependency CVEs, secrets scan.", ownerAgent: "QUALITY", department: "quality", priority: "CRITICAL", status: "IN_PROGRESS", progress: 80, dependencies: "[\"T-008\"]", expectedArtifact: "Security report", validation: "0 criticals; mediums tracked", estimatedHours: 5, actualHours: 4 },
    { taskId: "T-016", title: "End-to-end smoke test via agent-browser", description: "Verify render, interactivity, sticky footer, responsiveness.", ownerAgent: "QUALITY", department: "quality", priority: "HIGH", status: "IN_PROGRESS", progress: 60, dependencies: "[\"T-007\"]", expectedArtifact: "QA report", validation: "All golden-path flows pass", estimatedHours: 4, actualHours: 2 },
    { taskId: "T-025", title: "Load test WebSocket activity feed", description: "Sustained 1k events/sec for 5 min, measure latency.", ownerAgent: "QUALITY", department: "quality", priority: "LOW", status: "PENDING", progress: 0, dependencies: "[\"T-009\"]", expectedArtifact: "Load report", validation: "p99 < 500ms", estimatedHours: 3, actualHours: 0 },
  ];
  for (const t of tasks) {
    await db.genesisTask.upsert({
      where: { taskId: t.taskId },
      update: {},
      create: {
        ...t,
        startedAt: t.status !== "PENDING" ? new Date(now - 1000 * 60 * 60 * 3).toISOString() : null,
        completedAt: t.status === "DONE" ? new Date(now - 1000 * 60 * 30).toISOString() : null,
      },
    });
  }

  // ---------- MEMORY ----------
  const memory = [
    { type: "EPISODIC", title: "Deployment v0.7.2 rollback", content: "Release v0.7.2 caused 5xx spike on /api/tasks due to missing Prisma migration. Rolled back within 4 minutes. Root cause: schema push without migrate.", tags: JSON.stringify(["deploy", "incident", "prisma"]), importance: 9, source: "ENGINEERING" },
    { type: "EPISODIC", title: "Self-correction thrash on flaky test", content: "Self-correction loop retried 6 times on a timing-dependent test before root-causing clock skew in sandbox. Added confidence threshold to prevent future thrash.", tags: JSON.stringify(["self-correction", "flaky-test", "loop"]), importance: 8, source: "AI_SYSTEMS" },
    { type: "EPISODIC", title: "First user feedback batch ingested", content: "12 qualitative interviews coded into 7 themes. Top pain: onboarding confusion. Fed back to Design + Product.", tags: JSON.stringify(["research", "users", "feedback"]), importance: 7, source: "RESEARCH" },
    { type: "SEMANTIC", title: "Model routing policy", content: "Route formatting/extraction to cheap model; architecture/reasoning/debugging to advanced model. Threshold: token estimate + task class. Saved 34% cost this cycle.", tags: JSON.stringify(["ai", "cost", "orchestration"]), importance: 9, source: "AI_SYSTEMS" },
    { type: "SEMANTIC", title: "Architecture fact: single-route constraint", content: "Only / route is user-visible. All sections are tabs within page.tsx. API routes allowed under /api. WebSocket must use XTransformPort query param, never direct port in URL.", tags: JSON.stringify(["architecture", "constraint", "nextjs"]), importance: 10, source: "PRODUCT" },
    { type: "SEMANTIC", title: "No indigo/blue color rule", content: "Styling rule: avoid indigo and blue unless explicitly requested. Use emerald/cyan/amber/rose/violet palette.", tags: JSON.stringify(["design", "styling", "rule"]), importance: 6, source: "DESIGN" },
    { type: "SEMANTIC", title: "Prisma SQLite limitations", content: "SQLite does not support array/list primitives. Store arrays as JSON strings; parse on read. Database file at db/custom.db.", tags: JSON.stringify(["database", "prisma", "sqlite"]), importance: 8, source: "ENGINEERING" },
    { type: "PROCEDURAL", title: "SOP: adding a new API route", content: "1) Define Prisma model if needed. 2) db:push. 3) Create route.ts under src/app/api/genesis/<resource>. 4) Use db client from @/lib/db. 5) Return JSON. 6) Lint. 7) Smoke test via curl.", tags: JSON.stringify(["sop", "api", "backend"]), importance: 9, source: "ENGINEERING" },
    { type: "PROCEDURAL", title: "SOP: verifying with agent-browser", content: "After dev server stable: navigate to /, capture render, exercise golden path, check dev.log for runtime errors, verify sticky footer + responsiveness, fix + re-verify until clean.", tags: JSON.stringify(["sop", "qa", "verification"]), importance: 9, source: "QUALITY" },
    { type: "PROCEDURAL", title: "SOP: model orchestration routing", content: "Classify task → estimate tokens → pick tier (cheap/standard/advanced) → log cost → cache idempotent results. Escalate to advanced on retry failure.", tags: JSON.stringify(["sop", "ai", "cost"]), importance: 8, source: "AI_SYSTEMS" },
    { type: "EPISODIC", title: "Security scan flagged 2 mediums", content: "Scan found missing rate-limit on /api/genesis/seed and verbose error in /api/genesis/tasks. Both queued for remediation in T-015.", tags: JSON.stringify(["security", "finding"]), importance: 7, source: "QUALITY" },
    { type: "SEMANTIC", title: "Department ownership map", content: "CEO=ceo, RESEARCH=research, PRODUCT=product, ENGINEERING=engineering, AI_SYSTEMS=ai_systems, DESIGN=design, GROWTH=growth, QUALITY=quality. Tasks carry ownerAgent + department.", tags: JSON.stringify(["org", "departments"]), importance: 7, source: "CEO" },
  ];
  for (const m of memory) {
    const existing = await db.memoryEntry.findFirst({ where: { title: m.title } });
    if (!existing) await db.memoryEntry.create({ data: m });
  }

  // ---------- CEO DECISIONS ----------
  const decisions = [
    { title: "Prioritize auth over billing", rationale: "Billing depends on authenticated tenants; auth unblocks 3 downstream tasks.", decision: "Sequence: auth MVP → billing MVP. Reassign 1 growth agent to engineering.", impact: "HIGH", status: "EXECUTED" },
    { title: "Adopt SQLite for MVP sandbox", rationale: "Zero-ops, fast iteration. Accept HA risk; document as technical risk.", decision: "Use Prisma + SQLite. Migrate to Postgres post-MVP.", impact: "MEDIUM", status: "EXECUTED" },
    { title: "Model orchestration: tiered routing", rationale: "Single-model cost growing 18%/cycle. Tiered routing projected 30%+ savings.", decision: "Implement router with cheap/standard/advanced tiers.", impact: "HIGH", status: "EXECUTED" },
    { title: "Pause deployment loop after rollback", rationale: "v0.7.2 rollback indicates pipeline maturity gap. Avoid repeated incidents.", decision: "Pause deployment loop pending Quality sign-off.", impact: "CRITICAL", status: "EXECUTED" },
    { title: "Single visible route constraint", rationale: "Sandbox exposes one user route. Multi-route adds complexity without MVP value.", decision: "Implement all sections as tabs within / route.", impact: "MEDIUM", status: "EXECUTED" },
    { title: "Promote 3 pending tasks", rationale: "Dependencies resolved; engineering has capacity after T-008 completion.", decision: "Move T-020, T-021, T-022 to IN_PROGRESS.", impact: "MEDIUM", status: "PROPOSED" },
  ];
  for (const d of decisions) {
    const existing = await db.ceoDecision.findFirst({ where: { title: d.title } });
    if (!existing) await db.ceoDecision.create({ data: d });
  }

  // ---------- RESEARCH REPORTS ----------
  const reports = [
    {
      topic: "Autonomous agent OS market sizing",
      category: "MARKET",
      summary: "Emerging category combining agent orchestration + dev automation. Adjacent to AI coding tools & internal dev platforms.",
      findings: JSON.stringify([
        "AI coding tool market ~$2.4B 2024, CAGR 28%",
        "Agent orchestration platforms nascent; <15 serious vendors",
        "Demand signal strongest in 5-50 eng teams",
      ]),
      evidence: JSON.stringify(["gartner-2024", "stack-overflow-survey-2024", "internal-interviews-n12"]),
      confidence: 72,
    },
    {
      topic: "Competitor teardown: agent platforms",
      category: "COMPETITOR",
      summary: "4 platforms reviewed. Strengths in orchestration; gaps in observability + self-correction transparency.",
      findings: JSON.stringify([
        "Competitor A: strong agent SDK, weak ops UI",
        "Competitor B: good visual builder, closed model routing",
        "Differentiation: transparent loops + memory architecture",
      ]),
      evidence: JSON.stringify(["competitor-a-docs", "competitor-b-pricing", "feature-matrix-v2"]),
      confidence: 68,
    },
    {
      topic: "User pain: onboarding confusion",
      category: "USER",
      summary: "12 interviews. 8/12 found initial setup unclear; 6/12 abandoned before first task.",
      findings: JSON.stringify([
        "Onboarding completion 42%",
        "Top confusion: 'what does this agent actually do?'",
        "Fix: progressive disclosure + live activity preview",
      ]),
      evidence: JSON.stringify(["interviews-n12", "session-replay-cohort-q2"]),
      confidence: 81,
    },
    {
      topic: "Technology: edge-deployable agent runtimes",
      category: "TECHNOLOGY",
      summary: "Edge runtimes viable for cheap-tier routing; cold-start acceptable <150ms.",
      findings: JSON.stringify([
        "Edge cold-start p95 142ms (cheap tier)",
        "Advanced tier must stay on GPU-backed runtime",
        "Hybrid topology recommended",
      ]),
      evidence: JSON.stringify(["edge-benchmark-2024-q2", "internal-poc-edge-router"]),
      confidence: 76,
    },
    {
      topic: "Risk: model cost scaling",
      category: "RISK",
      summary: "Token spend growing 18%/cycle. Without routing, projected 3x in 30 cycles.",
      findings: JSON.stringify([
        "Current: $12.8/day, 4.8M tokens",
        "Tiered routing projects 34% reduction",
        "Cache layer projects additional 15%",
      ]),
      evidence: JSON.stringify(["cost-telemetry-cycle-7", "routing-poc-results"]),
      confidence: 84,
    },
    {
      topic: "Opportunity: feedback-driven product loop",
      category: "OPPORTUNITY",
      summary: "Closing feedback loop → product changes measurably lifts retention in pilot.",
      findings: JSON.stringify([
        "Pilot cohort retention +22% after loop closed",
        "Feedback latency dropped 4d → 6h",
        "Expand to all departments",
      ]),
      evidence: JSON.stringify(["pilot-cohort-q2", "retention-delta-report"]),
      confidence: 79,
    },
  ];
  for (const r of reports) {
    const existing = await db.researchReport.findFirst({ where: { topic: r.topic } });
    if (!existing) await db.researchReport.create({ data: r });
  }

  // ---------- ACTIVITY LOGS ----------
  const activity = [
    { agent: "ENGINEERING", action: "BUILD", detail: "Compiled dashboard route — 0 errors", level: "SUCCESS", category: "BUILD", taskId: "T-007" },
    { agent: "QUALITY", action: "SCAN", detail: "Security scan: 2 mediums, 0 criticals", level: "WARNING", category: "SECURITY", taskId: "T-015" },
    { agent: "AI_SYSTEMS", action: "ROUTE", detail: "Routed 1,204 tasks to cheap tier (savings $3.12)", level: "INFO", category: "TASK", taskId: "T-010" },
    { agent: "CEO", action: "DECISION", detail: "Sequenced auth → billing; reassigned 1 agent", level: "INFO", category: "DECISION", taskId: "T-017" },
    { agent: "SELF_CORRECTION", action: "FIX", detail: "Root-caused Prisma relation mismatch; patched in 1 cycle", level: "SUCCESS", category: "BUILD", taskId: "T-008" },
    { agent: "RESEARCH", action: "PUBLISH", detail: "Published competitor teardown (confidence 0.68)", level: "INFO", category: "RESEARCH", taskId: "T-018" },
    { agent: "ENGINEERING", action: "DEPLOY", detail: "Rolled back v0.7.2 — 5xx spike detected", level: "ERROR", category: "DEPLOY", taskId: "T-008" },
    { agent: "DESIGN", action: "REVIEW", detail: "HUD layout UX review passed", level: "SUCCESS", category: "TASK", taskId: "T-013" },
    { agent: "AI_SYSTEMS", action: "MEMORY", detail: "Promoted 4 procedural SOPs from episodic", level: "INFO", category: "MEMORY", taskId: "T-011" },
    { agent: "QUALITY", action: "TEST", detail: "Agent-browser smoke: render OK, 1 interaction flaky", level: "WARNING", category: "TEST", taskId: "T-016" },
    { agent: "GROWTH", action: "EXPERIMENT", detail: "Analytics funnel v1 live — events flowing", level: "INFO", category: "TASK", taskId: "T-024" },
    { agent: "ENGINEERING", action: "COMMIT", detail: "Checkpoint v0.7.3 — 8 changes, 142 tests passed", level: "SUCCESS", category: "BUILD", taskId: "T-008" },
    { agent: "AI_SYSTEMS", action: "ROUTE", detail: "Escalated 3 tasks to advanced tier (reasoning)", level: "INFO", category: "TASK", taskId: "T-010" },
    { agent: "SECURITY", action: "SCAN", detail: "No new secrets leaked; 1 dep CVE (medium) queued", level: "WARNING", category: "SECURITY" },
    { agent: "ENGINEERING", action: "BUILD", detail: "WebSocket mini-service skeleton compiling", level: "INFO", category: "BUILD", taskId: "T-009" },
    { agent: "RESEARCH", action: "INTERVIEW", detail: "Coded 12 user interviews into 7 themes", level: "SUCCESS", category: "RESEARCH", taskId: "T-004" },
    { agent: "CEO", action: "ALLOCATE", detail: "Rebalanced capacity: growth→engineering", level: "INFO", category: "DECISION", taskId: "T-002" },
    { agent: "DESIGN", action: "TOKENS", detail: "Design system tokens adopted across 47 components", level: "SUCCESS", category: "TASK", taskId: "T-012" },
    { agent: "FEEDBACK", action: "INGEST", detail: "3 feedback channels healthy; 1 degraded", level: "WARNING", category: "TASK" },
    { agent: "ENGINEERING", action: "BUILD", detail: "Memory bank CRUD endpoints return 2xx", level: "SUCCESS", category: "BUILD", taskId: "T-020" },
  ];
  const activityCount = await db.activityLog.count();
  if (activityCount === 0) {
    for (const a of activity) {
      await db.activityLog.create({
        data: { ...a, createdAt: new Date(now - Math.random() * 1000 * 60 * 60 * 2).toISOString() },
      });
    }
  }

  // ---------- SYSTEM METRICS ----------
  const metrics = [
    { name: "build_pass_rate", value: 0.94, unit: "ratio", category: "QUALITY", target: 0.95 },
    { name: "test_coverage", value: 0.81, unit: "ratio", category: "QUALITY", target: 0.85 },
    { name: "p99_api_latency_ms", value: 184, unit: "ms", category: "PERFORMANCE", target: 200 },
    { name: "model_cost_today_usd", value: 12.847, unit: "USD", category: "COST", target: 15 },
    { name: "tokens_today", value: 4823109, unit: "tokens", category: "THROUGHPUT" },
    { name: "agents_online", value: 14, unit: "count", category: "THROUGHPUT", target: 16 },
    { name: "tasks_completed_24h", value: 38, unit: "count", category: "THROUGHPUT" },
    { name: "uptime_ratio", value: 0.9986, unit: "ratio", category: "RELIABILITY", target: 0.999 },
    { name: "self_correction_success_rate", value: 0.91, unit: "ratio", category: "QUALITY", target: 0.95 },
    { name: "feedback_latency_h", value: 6, unit: "hours", category: "PERFORMANCE", target: 4 },
  ];
  for (const m of metrics) {
    await db.systemMetric.upsert({
      where: { name: m.name },
      update: { value: m.value },
      create: m,
    });
  }

  // ---------- BUILD CHECKPOINTS ----------
  const checkpoints = [
    { version: "v0.7.3", type: "COMMIT", summary: "Memory bank CRUD + loops status API skeleton", changesCount: 8, testsPassed: 142, testsFailed: 0, status: "PASSED" },
    { version: "v0.7.2", type: "RELEASE", summary: "Task graph API release — caused 5xx, rolled back", changesCount: 12, testsPassed: 138, testsFailed: 1, status: "ROLLBACK" },
    { version: "v0.7.1", type: "COMMIT", summary: "Model orchestration router + cost telemetry", changesCount: 6, testsPassed: 131, testsFailed: 0, status: "PASSED" },
    { version: "v0.7.0", type: "RELEASE", summary: "Command center dashboard MVP", changesCount: 24, testsPassed: 119, testsFailed: 0, status: "PASSED" },
    { version: "v0.6.4", type: "COMMIT", summary: "Design system tokens + HUD layout", changesCount: 9, testsPassed: 104, testsFailed: 0, status: "PASSED" },
  ];
  for (const c of checkpoints) {
    const existing = await db.buildCheckpoint.findFirst({ where: { version: c.version } });
    if (!existing) await db.buildCheckpoint.create({ data: c });
  }

  return { seeded: true, counts: { departments: departments.length, tasks: tasks.length, memory: memory.length, loops: loops.length } };
}
