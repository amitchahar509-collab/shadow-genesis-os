/**
 * SHADOW GENESIS OS — Activity Stream Mini-Service
 *
 * Socket.io server on port 3030 that simulates the live telemetry of an
 * autonomous AI company: agents across 8 departments continuously emit
 * realistic activity events (builds, scans, decisions, routing, fixes…).
 *
 * - On connect: emit a `snapshot` of recent in-memory events.
 * - Every 2.5–5s (jittered): generate a new event, broadcast `activity`,
 *   keep last 80 in memory, and POST it to the Next.js API
 *   (/api/genesis/activity) so DB-backed polling clients stay in sync.
 *
 * Frontend connects via io("/?XTransformPort=3030") (path "/" so Caddy
 * forwards correctly).
 */

import { createServer } from "http";
import { Server } from "socket.io";

const PORT = 3030;
const NEXT_API = "http://localhost:3000/api/genesis/activity";
const MAX_IN_MEMORY = 80;

type Level = "INFO" | "SUCCESS" | "WARNING" | "ERROR" | "CRITICAL";

interface ActivityLog {
  id: string;
  agent: string;
  action: string;
  detail: string;
  level: Level;
  category: string;
  taskId: string | null;
  createdAt: string;
}

// ---------- Event generator templates ----------
interface Template {
  agent: string;
  action: string;
  detail: string;
  level: Level;
  category: string;
  taskId?: string;
}

const TEMPLATES: Template[] = [
  // Engineering
  { agent: "ENGINEERING", action: "BUILD", detail: "Compiled dashboard route — 0 errors, 3 warnings", level: "SUCCESS", category: "BUILD", taskId: "T-007" },
  { agent: "ENGINEERING", action: "TEST", detail: "Ran 142 tests · 141 passed · 1 flaky (timing)", level: "WARNING", category: "TEST", taskId: "T-008" },
  { agent: "ENGINEERING", action: "COMMIT", detail: "Checkpoint created · 8 changes · message: 'memory bank CRUD'", level: "SUCCESS", category: "BUILD", taskId: "T-020" },
  { agent: "ENGINEERING", action: "FIX", detail: "Patched null deref in task resolver · regression test added", level: "SUCCESS", category: "BUILD", taskId: "T-008" },
  { agent: "ENGINEERING", action: "REFACTOR", detail: "Extracted shared panel primitive · -142 LOC", level: "INFO", category: "BUILD", taskId: "T-007" },
  // AI Systems
  { agent: "AI_SYSTEMS", action: "ROUTE", detail: "Routed 1,204 tasks → cheap tier · est. savings $3.12", level: "INFO", category: "TASK", taskId: "T-010" },
  { agent: "AI_SYSTEMS", action: "ROUTE", detail: "Escalated 3 reasoning tasks → advanced tier", level: "INFO", category: "TASK", taskId: "T-010" },
  { agent: "AI_SYSTEMS", action: "MEMORY", detail: "Consolidated 4 episodic → 2 procedural SOPs", level: "SUCCESS", category: "MEMORY", taskId: "T-011" },
  { agent: "AI_SYSTEMS", action: "TOOLS", detail: "Registered new tool: 'prisma-query' · permission gated", level: "INFO", category: "TASK", taskId: "T-022" },
  { agent: "AI_SYSTEMS", action: "CACHE", detail: "Cache hit ratio 0.62 · 18k tokens saved", level: "SUCCESS", category: "TASK", taskId: "T-010" },
  // CEO
  { agent: "CEO", action: "DECISION", detail: "Re-prioritized: auth MVP before billing MVP", level: "INFO", category: "DECISION", taskId: "T-017" },
  { agent: "CEO", action: "ALLOCATE", detail: "Rebalanced capacity · growth→engineering (+1 agent)", level: "INFO", category: "DECISION", taskId: "T-002" },
  { agent: "CEO", action: "REVIEW", detail: "Reviewed cycle 7 metrics · on-track vs north-star", level: "SUCCESS", category: "DECISION", taskId: "T-001" },
  // Research
  { agent: "RESEARCH", action: "SCAN", detail: "Scanned 47 sources for 'agent orchestration' queries", level: "INFO", category: "RESEARCH", taskId: "T-018" },
  { agent: "RESEARCH", action: "PUBLISH", detail: "Published competitor teardown · confidence 0.68", level: "INFO", category: "RESEARCH", taskId: "T-018" },
  { agent: "RESEARCH", action: "INTERVIEW", detail: "Coded interview #12 · theme: onboarding friction", level: "SUCCESS", category: "RESEARCH", taskId: "T-004" },
  // Product
  { agent: "PRODUCT", action: "BLUEPRINT", detail: "Updated API contract · added /memory endpoints", level: "INFO", category: "TASK", taskId: "T-006" },
  { agent: "PRODUCT", action: "SPEC", detail: "Drafted RBAC schema v0 · awaiting security review", level: "WARNING", category: "TASK", taskId: "T-019" },
  // Design
  { agent: "DESIGN", action: "TOKENS", detail: "Aligned color tokens across 47 components", level: "SUCCESS", category: "TASK", taskId: "T-012" },
  { agent: "DESIGN", action: "PROTOTYPE", detail: "Prototyping animated metric viz · 58fps", level: "INFO", category: "TASK", taskId: "T-023" },
  { agent: "DESIGN", action: "REVIEW", detail: "UX review passed · HUD layout sticky footer OK", level: "SUCCESS", category: "TASK", taskId: "T-013" },
  // Growth
  { agent: "GROWTH", action: "EXPERIMENT", detail: "Experiment G-5 live · variant B conversion +0.4%", level: "INFO", category: "TASK", taskId: "T-024" },
  { agent: "GROWTH", action: "FUNNEL", detail: "Funnel events flowing · 1,284 organic users this week", level: "SUCCESS", category: "TASK", taskId: "T-024" },
  // Quality
  { agent: "QUALITY", action: "SCAN", detail: "Security scan · 0 criticals · 2 mediums queued", level: "WARNING", category: "SECURITY", taskId: "T-015" },
  { agent: "QUALITY", action: "TEST", detail: "Agent-browser smoke · render OK · 1 interaction flaky", level: "WARNING", category: "TEST", taskId: "T-016" },
  { agent: "QUALITY", action: "AUDIT", detail: "Audited /api/genesis/tasks · input validation OK", level: "SUCCESS", category: "SECURITY", taskId: "T-015" },
  { agent: "QUALITY", action: "REPORT", detail: "QA report v0.7.3 · golden path 5/6 pass", level: "INFO", category: "TEST", taskId: "T-016" },
  // Self-correction
  { agent: "SELF_CORRECTION", action: "FIX", detail: "Root-caused Prisma relation mismatch · 1 cycle fix", level: "SUCCESS", category: "BUILD", taskId: "T-008" },
  { agent: "SELF_CORRECTION", action: "ROOT_CAUSE", detail: "Identified flaky test cause: sandbox clock skew", level: "INFO", category: "BUILD" },
  { agent: "SELF_CORRECTION", action: "RETRY", detail: "Retry attempt 2/3 · confidence threshold met", level: "WARNING", category: "BUILD" },
  // Security
  { agent: "SECURITY", action: "SCAN", detail: "Secrets scan clean · 0 leaked keys detected", level: "SUCCESS", category: "SECURITY" },
  { agent: "SECURITY", action: "ALERT", detail: "Dep CVE (medium) in transitive dep · upgrade queued", level: "WARNING", category: "SECURITY" },
  { agent: "SECURITY", action: "AUDIT", detail: "Authorization audit · all /api routes gated", level: "SUCCESS", category: "SECURITY" },
  // Feedback
  { agent: "FEEDBACK", action: "INGEST", detail: "Ingested 23 feedback events · channel 3 degraded", level: "WARNING", category: "TASK" },
  { agent: "FEEDBACK", action: "ANALYZE", detail: "Feedback → theme mapping · 4 new insights", level: "INFO", category: "TASK" },
  // Deployment
  { agent: "ENGINEERING", action: "DEPLOY", detail: "Deployment loop paused · awaiting QA sign-off", level: "WARNING", category: "DEPLOY" },
  { agent: "ENGINEERING", action: "BUILD", detail: "Build green · 142/142 tests · ready for checkpoint", level: "SUCCESS", category: "BUILD" },
];

const recent: ActivityLog[] = [];
let counter = 0;

function genId(): string {
  counter += 1;
  return `ws-${Date.now()}-${counter}`;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function makeEvent(): ActivityLog {
  const t = pick(TEMPLATES);
  // small jitter on detail to feel live
  return {
    id: genId(),
    agent: t.agent,
    action: t.action,
    detail: t.detail,
    level: t.level,
    category: t.category,
    taskId: t.taskId ?? null,
    createdAt: new Date().toISOString(),
  };
}

async function persistToDb(log: ActivityLog) {
  try {
    await fetch(NEXT_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent: log.agent,
        action: log.action,
        detail: log.detail,
        level: log.level,
        category: log.category,
        taskId: log.taskId,
      }),
    });
  } catch {
    // Next.js may be mid-restart; ignore — in-memory list still serves clients
  }
}

function scheduleNext() {
  const delay = 2500 + Math.random() * 2500; // 2.5s–5s
  setTimeout(async () => {
    const ev = makeEvent();
    recent.unshift(ev);
    if (recent.length > MAX_IN_MEMORY) recent.length = MAX_IN_MEMORY;
    io.emit("activity", ev);
    // fire-and-forget DB persist
    persistToDb(ev);
    scheduleNext();
  }, delay);
}

// ---------- Server ----------
const httpServer = createServer();
const io = new Server(httpServer, {
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

io.on("connection", (socket) => {
  console.log(`[activity-service] client connected: ${socket.id}`);
  socket.emit("snapshot", recent.slice(0, 30));
  socket.on("request-snapshot", () => {
    socket.emit("snapshot", recent.slice(0, 30));
  });
  socket.on("disconnect", () => {
    console.log(`[activity-service] client disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[activity-service] SHADOW GENESIS activity stream live on :${PORT}`);
  scheduleNext();
});

process.on("SIGTERM", () => {
  console.log("[activity-service] SIGTERM, shutting down…");
  io.close();
  httpServer.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  console.log("[activity-service] SIGINT, shutting down…");
  io.close();
  httpServer.close(() => process.exit(0));
});
