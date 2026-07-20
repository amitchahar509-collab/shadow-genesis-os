/**
 * SHADOW GENESIS OS — Activity Stream Mini-Service (V4 — REAL events only)
 *
 * Socket.io server on port 3030 that bridges agent-runtime events to the
 * dashboard in real time. NO FAKE TEMPLATES.
 *
 * v4 changes:
 *   - The fake template generator is REMOVED. Zero simulated events.
 *   - HTTP endpoint `POST /broadcast` accepts real ActivityEvents from
 *     the agent runtime (src/lib/genesis/agent-runtime/event-bus.ts).
 *   - Socket.io protocol unchanged (path "/", `activity` / `snapshot` /
 *     `request-snapshot` events) so dashboard client works unmodified.
 *   - 30s heartbeat pulls REAL queue status from
 *     /api/genesis/orchestrator/status (no fake data).
 *   - On startup, emits a "service started" event so clients know it's live.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { Server } from "socket.io";

const PORT = 3030;
const NEXT_API = "http://localhost:3000/api/genesis/activity";
const ORCHESTRATOR_STATUS = "http://localhost:3000/api/genesis/orchestrator/status";
const MAX_IN_MEMORY = 200;

type Level = "INFO" | "SUCCESS" | "WARNING" | "ERROR" | "CRITICAL";

interface ActivityLog {
  id: string;
  agent: string;
  action: string;
  detail: string;
  level: Level;
  category: string;
  taskId: string | null;
  executionId?: string | null;
  createdAt: string;
}

const recent: ActivityLog[] = [];
let counter = 0;

function genId(): string {
  counter += 1;
  return `ws-${Date.now()}-${counter}`;
}

function pushEvent(ev: ActivityLog) {
  recent.unshift(ev);
  if (recent.length > MAX_IN_MEMORY) recent.length = MAX_IN_MEMORY;
  io.emit("activity", ev);
}

// ---------- HTTP broadcast endpoint (real events from runtime) ----------
const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === "POST" && req.url === "/broadcast") {
    let body = "";
    for await (const chunk of req) body += chunk.toString();
    try {
      const ev = JSON.parse(body) as Partial<ActivityLog>;
      if (!ev.agent || !ev.action) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "agent and action required" }));
        return;
      }
      const log: ActivityLog = {
        id: genId(),
        agent: ev.agent,
        action: ev.action,
        detail: ev.detail ?? "",
        level: (ev.level as Level) ?? "INFO",
        category: ev.category ?? "SYSTEM",
        taskId: ev.taskId ?? null,
        executionId: ev.executionId ?? null,
        createdAt: new Date().toISOString(),
      };
      pushEvent(log);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, id: log.id }));
    } catch (e) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    }
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, recent: recent.length, uptime: process.uptime(), fakeEvents: 0 }));
    return;
  }
  if (req.method === "GET" && req.url === "/snapshot") {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(recent.slice(0, 30)));
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});

// ---------- Socket.io layer ----------
const io = new Server(httpServer, {
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

io.on("connection", (socket) => {
  console.log(`[activity-service v4] client connected: ${socket.id}`);
  socket.emit("snapshot", recent.slice(0, 30));
  socket.on("request-snapshot", () => {
    socket.emit("snapshot", recent.slice(0, 30));
  });
  socket.on("disconnect", () => {
    console.log(`[activity-service v4] client disconnected: ${socket.id}`);
  });
});

// ---------- Heartbeat (real status, every 30s) ----------
async function heartbeat() {
  try {
    const r = await fetch(ORCHESTRATOR_STATUS, { signal: AbortSignal.timeout(3_000) });
    if (!r.ok) return;
    const data = (await r.json()) as { status: { queued: number; inProgress: number; doneToday: number; failedToday: number; agentLocks: string[]; activeMissions: number; } };
    const s = data.status;
    const log: ActivityLog = {
      id: genId(),
      agent: "ORCHESTRATOR",
      action: "STATUS",
      detail: `queue: ${s.queued} pending · ${s.inProgress} in-progress · ${s.activeMissions} active missions · today ${s.doneToday} done / ${s.failedToday} failed`,
      level: "INFO",
      category: "SYSTEM",
      taskId: null,
      createdAt: new Date().toISOString(),
    };
    pushEvent(log);
  } catch {
    // Next.js down — skip heartbeat
  }
}

httpServer.listen(PORT, () => {
  console.log(`[activity-service v4] SHADOW GENESIS REAL-event broadcaster live on :${PORT}`);
  console.log(`[activity-service v4] POST /broadcast ← agent runtime events`);
  console.log(`[activity-service v4] socket.io path "/" for dashboard clients`);
  console.log(`[activity-service v4] NO FAKE TEMPLATES — real events only`);
  // Emit startup event
  pushEvent({
    id: genId(),
    agent: "SYSTEM",
    action: "STARTED",
    detail: "Activity service v4 started — real events only, no fake templates",
    level: "SUCCESS",
    category: "SYSTEM",
    taskId: null,
    createdAt: new Date().toISOString(),
  });
  setInterval(heartbeat, 30_000);
});

process.on("SIGTERM", () => {
  console.log("[activity-service v4] SIGTERM, shutting down…");
  io.close();
  httpServer.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  console.log("[activity-service v4] SIGINT, shutting down…");
  io.close();
  httpServer.close(() => process.exit(0));
});
