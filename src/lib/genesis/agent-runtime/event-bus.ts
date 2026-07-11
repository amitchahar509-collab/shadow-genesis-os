/** Live event bus — runtime → DB → socket.io. No fake templates. */

import { db } from "@/lib/db";
import { redactSecrets } from "./security-engine/secrets";

export type ActivityLevel = "INFO" | "SUCCESS" | "WARNING" | "ERROR" | "CRITICAL";
export type ActivityCategory = "TASK" | "BUILD" | "TEST" | "DEPLOY" | "SECURITY" | "MEMORY" | "DECISION" | "RESEARCH" | "TOOL" | "SYSTEM" | "OPPORTUNITY" | "REVENUE" | "GROWTH";

export interface ActivityEvent {
  agent: string;
  action: string;
  detail: string;
  level: ActivityLevel;
  category: ActivityCategory;
  taskId?: string | null;
  executionId?: string | null;
}

type Subscriber = (event: ActivityEvent) => void;
const subscribers = new Set<Subscriber>();

export function subscribe(fn: Subscriber): () => void { subscribers.add(fn); return () => subscribers.delete(fn); }

function emitLocal(e: ActivityEvent) { for (const fn of subscribers) { try { fn(e); } catch {} } }

export async function emit(event: ActivityEvent): Promise<void> {
  // V10 Module 6 — SEC-2: redact any secret before it reaches a sink (DB, socket, subscribers).
  const safe: ActivityEvent = { ...event, detail: redactSecrets(event.detail) };
  emitLocal(safe);
  try {
    await db.activityLog.create({ data: { agent: safe.agent, action: safe.action, detail: safe.detail, level: safe.level, category: safe.category, taskId: safe.taskId ?? null } });
  } catch (e) { console.error("[event-bus] DB write failed:", e instanceof Error ? e.message : e); }
  try {
    await fetch("http://127.0.0.1:3030/broadcast", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(safe), signal: AbortSignal.timeout(2_000) }).catch(() => {});
  } catch {}
}

export const events = {
  tool: (agent: string, execId: string | null, detail: string, level: ActivityLevel = "INFO"): ActivityEvent => ({ agent, action: "TOOL", detail, level, category: "TOOL", taskId: null, executionId: execId }),
  decision: (agent: string, detail: string, level: ActivityLevel = "INFO"): ActivityEvent => ({ agent, action: "DECISION", detail, level, category: "DECISION" }),
  build: (agent: string, detail: string, level: ActivityLevel = "INFO"): ActivityEvent => ({ agent, action: "BUILD", detail, level, category: "BUILD" }),
  test: (agent: string, detail: string, level: ActivityLevel = "INFO"): ActivityEvent => ({ agent, action: "TEST", detail, level, category: "TEST" }),
  research: (agent: string, detail: string, level: ActivityLevel = "INFO"): ActivityEvent => ({ agent, action: "RESEARCH", detail, level, category: "RESEARCH" }),
  security: (agent: string, detail: string, level: ActivityLevel = "WARNING"): ActivityEvent => ({ agent, action: "SECURITY", detail, level, category: "SECURITY" }),
  memory: (agent: string, detail: string, level: ActivityLevel = "INFO"): ActivityEvent => ({ agent, action: "MEMORY", detail, level, category: "MEMORY" }),
  opportunity: (agent: string, detail: string, level: ActivityLevel = "INFO"): ActivityEvent => ({ agent, action: "OPPORTUNITY", detail, level, category: "OPPORTUNITY" }),
  revenue: (agent: string, detail: string, level: ActivityLevel = "INFO"): ActivityEvent => ({ agent, action: "REVENUE", detail, level, category: "REVENUE" }),
  growth: (agent: string, detail: string, level: ActivityLevel = "INFO"): ActivityEvent => ({ agent, action: "GROWTH", detail, level, category: "GROWTH" }),
  error: (agent: string, detail: string): ActivityEvent => ({ agent, action: "ERROR", detail, level: "ERROR", category: "SYSTEM" }),
};
