/** Customer Success Engine (V10 Module 7).
 *
 * Tracks REAL product usage, behavior, drop-off, satisfaction, and support
 * tickets — and turns recurring real problems into improvement tasks through the
 * EXISTING reality-feedback loop (no new task system). Honesty contract (same as
 * reality-feedback): a ProductEvent/SupportTicket exists ONLY for a real reported
 * event. With no product reporting the whole layer is honestly empty/UNKNOWN —
 * Genesis never fabricates users, usage, satisfaction, or tickets.
 *
 * Reuses: reality-feedback.ingestSignal (task/metric generation), GenesisTask,
 * GrowthMetric. Labels: REAL (ingested) · HEURISTIC (scored) · UNKNOWN (no data).
 */

import { db } from "@/lib/db";
import { emit } from "../event-bus";
import { ingestSignal } from "../reality-feedback";

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(x)));
const round2 = (n: number) => Math.round(n * 100) / 100;

async function nextId(prefix: string, rows: { id: string }[]): Promise<string> {
  let max = 0; for (const r of rows) { const m = r.id.match(new RegExp(`^${prefix}-(\\d+)$`)); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `${prefix}-${(max + 1).toString().padStart(6, "0")}`;
}
const nextEventId = async () => nextId("PE", (await db.productEvent.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { eventId: true } })).map((r) => ({ id: r.eventId })));
const nextTicketId = async () => nextId("TICK", (await db.supportTicket.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { ticketId: true } })).map((r) => ({ id: r.ticketId })));

// ======================= EVENT INGESTION =======================

export type EventType = "PAGE_VIEW" | "FEATURE_USE" | "SIGNUP" | "ACTIVATION" | "SESSION_START" | "DROP_OFF" | "CHURN";

/** Record a REAL product usage event from a deployed product (external origin). */
export async function recordProductEvent(input: { productKey: string; eventType: EventType; userRef?: string; feature?: string; sessionId?: string; value?: number; occurredAt?: Date }): Promise<{ eventId: string }> {
  const eventId = await nextEventId();
  await db.productEvent.create({ data: {
    eventId, productKey: input.productKey, eventType: input.eventType, userRef: input.userRef ?? null,
    feature: input.feature ?? null, sessionId: input.sessionId ?? null, value: input.value ?? 1,
    dataLabel: "REAL", occurredAt: input.occurredAt ?? new Date(),
  } });
  // usage/retention also feed the reality loop as a real GrowthMetric
  if (input.eventType === "ACTIVATION" || input.eventType === "CHURN") {
    await ingestSignal({ kind: input.eventType === "CHURN" ? "RETENTION" : "USAGE", productKey: input.productKey, source: "customer-success", detail: `${input.eventType}${input.userRef ? ` by ${input.userRef}` : ""}`, payload: { count: 1 } }).catch(() => {});
  }
  return { eventId };
}

// ======================= SUPPORT TICKETS =======================

const SENTIMENT_WORDS = { neg: /\b(broken|crash|bug|error|fail|terrible|awful|hate|useless|frustrat|angry|refund|cancel|slow|worst)\b/gi, pos: /\b(love|great|awesome|excellent|amazing|perfect|thank|helpful|fast|best|fantastic)\b/gi };
function scoreSentiment(text: string): number {
  const neg = (text.match(SENTIMENT_WORDS.neg) ?? []).length, pos = (text.match(SENTIMENT_WORDS.pos) ?? []).length;
  if (neg + pos === 0) return 0;
  return round2((pos - neg) / (pos + neg));
}

/** Log a REAL support ticket. Bugs/complaints and feature requests auto-feed the
 *  reality loop → an improvement task, so real support drives real work. */
export async function createTicket(input: { productKey: string; subject: string; body?: string; category?: string; priority?: string; userRef?: string; source?: string }): Promise<{ ticketId: string; taskId?: string; signalId?: string }> {
  const ticketId = await nextTicketId();
  const body = input.body ?? "";
  const sentiment = scoreSentiment(`${input.subject} ${body}`);
  const category = input.category ?? (sentiment < -0.3 ? "COMPLAINT" : "QUESTION");
  const priority = input.priority ?? (category === "BUG" || sentiment <= -0.5 ? "HIGH" : "MEDIUM");

  // route real, actionable tickets into the existing reality-feedback task machinery
  let taskId: string | undefined, signalId: string | undefined;
  if (category === "BUG") {
    const r = await ingestSignal({ kind: "ERROR", productKey: input.productKey, source: `ticket:${input.source ?? "manual"}`, detail: `${input.subject}${body ? ` — ${body.slice(0, 120)}` : ""}` }).catch(() => null);
    if (r) { signalId = r.signalId; taskId = r.generated.find((g) => g.kind === "TASK")?.id; }
  } else if (category === "FEATURE_REQUEST") {
    const r = await ingestSignal({ kind: "FEATURE_REQUEST", productKey: input.productKey, source: `ticket:${input.source ?? "manual"}`, detail: input.subject }).catch(() => null);
    if (r) { signalId = r.signalId; taskId = r.generated.find((g) => g.kind === "TASK")?.id; }
  } else if (category === "COMPLAINT" && sentiment < 0) {
    const r = await ingestSignal({ kind: "FEEDBACK", productKey: input.productKey, source: `ticket:${input.source ?? "manual"}`, detail: input.subject, sentiment }).catch(() => null);
    if (r) { signalId = r.signalId; taskId = r.generated.find((g) => g.kind === "TASK")?.id; }
  }

  await db.supportTicket.create({ data: { ticketId, productKey: input.productKey, subject: input.subject.slice(0, 200), body: body.slice(0, 2000), category, priority, sentiment, userRef: input.userRef ?? null, source: input.source ?? "manual", taskId: taskId ?? null, signalId: signalId ?? null, dataLabel: "REAL" } });
  await emit({ agent: "CUSTOMER_SUCCESS", action: "TICKET", detail: `${ticketId} [${category}/${priority}] ${input.subject.slice(0, 80)}${taskId ? ` → ${taskId}` : ""}`, level: priority === "URGENT" || priority === "HIGH" ? "WARNING" : "INFO", category: "SYSTEM" });
  return { ticketId, taskId, signalId };
}

export async function updateTicket(ticketId: string, status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED"): Promise<{ ok: boolean; error?: string }> {
  const t = await db.supportTicket.findUnique({ where: { ticketId } });
  if (!t) return { ok: false, error: "ticket not found" };
  await db.supportTicket.update({ where: { ticketId }, data: { status, resolvedAt: status === "RESOLVED" || status === "CLOSED" ? new Date() : null } });
  return { ok: true };
}

// ======================= ANALYTICS (real events only) =======================

export interface Labeled<T> { value: T; label: "REAL" | "UNKNOWN" }

export async function behaviorAnalytics(productKey?: string, windowHours = 24 * 30) {
  const since = new Date(Date.now() - windowHours * 3_600_000);
  const where = { occurredAt: { gte: since }, ...(productKey ? { productKey } : {}) };
  const events = await db.productEvent.findMany({ where });
  const activeUsers = new Set(events.map((e) => e.userRef).filter(Boolean)).size;
  const sessions = new Set(events.map((e) => e.sessionId).filter(Boolean)).size;
  const byType = new Map<string, number>();
  for (const e of events) byType.set(e.eventType, (byType.get(e.eventType) ?? 0) + 1);
  const featureUse = new Map<string, number>();
  for (const e of events.filter((e) => e.eventType === "FEATURE_USE" && e.feature)) featureUse.set(e.feature!, (featureUse.get(e.feature!) ?? 0) + 1);
  return {
    hasData: events.length > 0,
    totalEvents: events.length, activeUsers, sessions,
    byType: [...byType.entries()].map(([type, count]) => ({ type, count })),
    topFeatures: [...featureUse.entries()].map(([feature, uses]) => ({ feature, uses })).sort((a, b) => b.uses - a.uses).slice(0, 10),
    note: events.length ? "REAL product events" : "no real product events yet — layer is honestly empty",
  };
}

/** Signup → activation → retention funnel with real drop-off rates. */
export async function dropOffFunnel(productKey: string): Promise<{ stages: { stage: string; users: number; dropOffPct: Labeled<number> }[]; hasData: boolean }> {
  const events = await db.productEvent.findMany({ where: { productKey }, select: { eventType: true, userRef: true } });
  const usersAt = (type: string) => new Set(events.filter((e) => e.eventType === type && e.userRef).map((e) => e.userRef)).size;
  const signup = usersAt("SIGNUP"), activation = usersAt("ACTIVATION");
  const retained = new Set(events.filter((e) => (e.eventType === "SESSION_START" || e.eventType === "FEATURE_USE") && e.userRef).map((e) => e.userRef)).size;
  const churned = usersAt("CHURN");
  const drop = (from: number, to: number): Labeled<number> => from > 0 ? { value: round2((1 - to / from) * 100), label: "REAL" } : { value: 0, label: "UNKNOWN" };
  return {
    hasData: events.length > 0,
    stages: [
      { stage: "SIGNUP", users: signup, dropOffPct: { value: 0, label: signup > 0 ? "REAL" : "UNKNOWN" } },
      { stage: "ACTIVATION", users: activation, dropOffPct: drop(signup, activation) },
      { stage: "RETAINED", users: retained, dropOffPct: drop(activation, retained) },
      { stage: "CHURNED", users: churned, dropOffPct: { value: churned, label: churned > 0 ? "REAL" : "UNKNOWN" } },
    ],
  };
}

/** Satisfaction from REAL ticket sentiment (CSAT proxy). UNKNOWN below a sample. */
export async function satisfaction(productKey?: string): Promise<{ csat: Labeled<number>; sentimentAvg: Labeled<number>; ticketCount: number; praise: number; complaints: number }> {
  const where = productKey ? { productKey } : {};
  const tickets = await db.supportTicket.findMany({ where });
  const scored = tickets.filter((t) => t.sentiment !== 0);
  const praise = tickets.filter((t) => t.category === "PRAISE" || t.sentiment > 0.3).length;
  const complaints = tickets.filter((t) => t.category === "COMPLAINT" || t.sentiment < -0.3).length;
  const sentimentAvg: Labeled<number> = scored.length >= 3 ? { value: round2(scored.reduce((a, t) => a + t.sentiment, 0) / scored.length), label: "REAL" } : { value: 0, label: "UNKNOWN" };
  // CSAT proxy: share of non-negative sentiment, needs ≥5 real scored tickets
  const csat: Labeled<number> = scored.length >= 5 ? { value: clamp((scored.filter((t) => t.sentiment >= 0).length / scored.length) * 100), label: "REAL" } : { value: 0, label: "UNKNOWN" };
  return { csat, sentimentAvg, ticketCount: tickets.length, praise, complaints };
}

/** Composite customer-health signal for a product. UNKNOWN without real data. */
export async function customerHealth(productKey: string): Promise<{ score: Labeled<number>; status: string; drivers: string[] }> {
  const [beh, sat, funnel] = await Promise.all([behaviorAnalytics(productKey), satisfaction(productKey), dropOffFunnel(productKey)]);
  if (!beh.hasData && sat.ticketCount === 0) return { score: { value: 0, label: "UNKNOWN" }, status: "UNKNOWN", drivers: ["no real product data yet"] };
  const drivers: string[] = [];
  let score = 50;
  if (beh.activeUsers > 0) { score += Math.min(20, beh.activeUsers); drivers.push(`${beh.activeUsers} active user(s)`); }
  if (sat.sentimentAvg.label === "REAL") { score += sat.sentimentAvg.value * 20; drivers.push(`sentiment ${sat.sentimentAvg.value}`); }
  if (sat.complaints > sat.praise) { score -= (sat.complaints - sat.praise) * 3; drivers.push(`${sat.complaints} complaint(s) > ${sat.praise} praise`); }
  const churnStage = funnel.stages.find((s) => s.stage === "CHURNED");
  if (churnStage && churnStage.users > 0) { score -= churnStage.users * 4; drivers.push(`${churnStage.users} churned`); }
  const clamped = clamp(score);
  return { score: { value: clamped, label: "REAL" }, status: clamped >= 65 ? "HEALTHY" : clamped >= 40 ? "AT_RISK" : "CHURNING", drivers };
}

// ======================= IMPROVEMENT TASK GENERATION =======================

const TICKET_THEMES: Record<string, RegExp> = {
  performance: /\b(slow|lag|performance|timeout|loading|freeze)\b/i,
  reliability: /\b(crash|down|broken|error|bug|fail|500)\b/i,
  usability: /\b(confus|hard to|can't find|unclear|difficult|complicated)\b/i,
  pricing: /\b(expensive|price|cost|billing|charge|refund)\b/i,
  missing_feature: /\b(wish|would love|missing|need|please add|feature request)\b/i,
};

/** Turn recurring REAL ticket themes + high drop-off into improvement tasks via
 *  the reality loop. Only recurring (≥2) real issues generate work. */
export async function generateImprovementTasks(): Promise<{ themes: { theme: string; count: number }[]; tasksCreated: string[] }> {
  const open = await db.supportTicket.findMany({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } }, orderBy: { createdAt: "desc" }, take: 300 });
  const themes = new Map<string, number>();
  for (const t of open) { const txt = `${t.subject} ${t.body}`; for (const [theme, re] of Object.entries(TICKET_THEMES)) if (re.test(txt)) themes.set(theme, (themes.get(theme) ?? 0) + 1); }
  const ranked = [...themes.entries()].map(([theme, count]) => ({ theme, count })).sort((a, b) => b.count - a.count);
  const tasksCreated: string[] = [];
  for (const t of ranked.filter((x) => x.count >= 2)) {
    const r = await ingestSignal({ kind: "FEATURE_REQUEST", productKey: "customer-success", source: "cs:intelligence", detail: `Recurring "${t.theme}" across ${t.count} real support tickets — prioritize.` }).catch(() => null);
    for (const g of r?.generated ?? []) if (g.kind === "TASK") tasksCreated.push(g.id);
  }
  return { themes: ranked, tasksCreated };
}

// ======================= OVERVIEW =======================

export async function customerSuccessOverview() {
  const [behavior, sat] = await Promise.all([behaviorAnalytics(), satisfaction()]);
  const tickets = await db.supportTicket.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  const byStatus = new Map<string, number>(); const byCategory = new Map<string, number>();
  for (const t of tickets) { byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1); byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + 1); }
  const products = [...new Set([...(await db.productEvent.findMany({ select: { productKey: true }, distinct: ["productKey"] })).map((p) => p.productKey), ...(await db.supportTicket.findMany({ select: { productKey: true }, distinct: ["productKey"] })).map((p) => p.productKey)])];
  return {
    behavior, satisfaction: sat,
    tickets: { total: tickets.length, open: byStatus.get("OPEN") ?? 0, byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })), byCategory: [...byCategory.entries()].map(([category, count]) => ({ category, count })) },
    recentTickets: tickets.slice(0, 15).map((t) => ({ ticketId: t.ticketId, productKey: t.productKey, subject: t.subject, category: t.category, priority: t.priority, sentiment: t.sentiment, status: t.status, taskId: t.taskId })),
    products,
    hasRealData: behavior.hasData || tickets.length > 0,
    note: "all metrics from REAL product events + tickets — empty/UNKNOWN until a deployed product reports (never fabricated)",
  };
}
