/** Reality Feedback Brain (V8 G9) — products teach Genesis.
 *
 * Deployed products call back with REAL telemetry; Genesis reacts. This is the
 * outer learning loop and the ONLY legitimate source of REAL (non-simulated)
 * product data — signals originate outside Genesis's own reasoning, so they are
 * the one thing the honesty rules let us label REAL.
 *
 *   ingest → persist RealitySignal (RS-) → process by kind:
 *     ERROR / FAILURE  → improvement GenesisTask (QUALITY/ENGINEERING)
 *     FEEDBACK (neg)   → improvement task + memory
 *     FEATURE_REQUEST  → improvement task (GROWTH backlog) + memory
 *     USAGE / RETENTION→ real GrowthMetric (now legitimately REAL) + memory
 *     CONVERSION       → completes the matching AWAITING_EXECUTION acquisition
 *                        CHANNEL experiment with dataSource=REAL — closing the
 *                        boundary the Acquisition Engine deliberately left open.
 *   every signal → EPISODIC memory (Products → Genesis Memory) + actedOn=true.
 *
 * Genesis never fabricates usage: with no product reporting, this layer is
 * empty. A test/e2e plays the product (the external caller), which is exactly
 * the contract — the signal's REAL label reflects its ingestion-boundary origin.
 */

import { db } from "@/lib/db";
import { nextTaskNumber } from "../agents/core";
import { getMemoryEngine } from "../memory/engine";
import { emit } from "../event-bus";

export type SignalKind = "ERROR" | "FEEDBACK" | "FEATURE_REQUEST" | "USAGE" | "RETENTION" | "CONVERSION";

export interface IngestInput {
  kind: SignalKind;
  productKey: string;        // the deployed product/company reporting — required (external origin)
  source: string;            // e.g. "sentry", "app-telemetry", "in-app-survey"
  detail: string;            // human-readable signal
  subject?: string;          // opportunityId | companyKey for loop linkage
  sentiment?: number;        // -1..1 (FEEDBACK)
  payload?: Record<string, unknown>; // structured data (e.g. {conversions, visitors} for CONVERSION)
  projectId?: string;
}

export interface GeneratedItem { kind: string; id: string }
export interface ProcessResult {
  signalId: string; kind: SignalKind; impact: string; generated: GeneratedItem[]; summary: string;
}

const KIND_TYPE: Record<SignalKind, string> = {
  ERROR: "FAILURE", FEEDBACK: "USER_FEEDBACK", FEATURE_REQUEST: "USER_FEEDBACK",
  USAGE: "ANALYTICS", RETENTION: "ANALYTICS", CONVERSION: "MARKET_RESPONSE",
};

async function nextSignalId(): Promise<string> {
  const rows = await db.realitySignal.findMany({ where: { signalId: { not: null } }, orderBy: { createdAt: "desc" }, take: 50, select: { signalId: true } });
  let max = 0;
  for (const r of rows) { const m = r.signalId?.match(/^RS-(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `RS-${(max + 1).toString().padStart(6, "0")}`;
}

async function makeTask(owner: string, department: string, title: string, description: string, priority = "HIGH"): Promise<string> {
  const taskId = `T-${(await nextTaskNumber()).toString().padStart(3, "0")}`;
  await db.genesisTask.create({
    data: { taskId, title: title.slice(0, 120), description: description.slice(0, 500), ownerAgent: owner, department, priority, status: "PENDING", dependencies: "[]", expectedArtifact: "fix / improvement", validation: "signal addressed", estimatedHours: 1 },
  });
  return taskId;
}

/** Ingest a real product signal and immediately react. */
export async function ingestSignal(input: IngestInput): Promise<ProcessResult> {
  const impact = input.sentiment !== undefined ? (input.sentiment > 0.2 ? "POSITIVE" : input.sentiment < -0.2 ? "NEGATIVE" : "NEUTRAL")
    : input.kind === "ERROR" ? "NEGATIVE" : input.kind === "CONVERSION" || input.kind === "RETENTION" ? "POSITIVE" : "NEUTRAL";
  const signalId = await nextSignalId();
  const signal = await db.realitySignal.create({
    data: {
      signalId, kind: input.kind, type: KIND_TYPE[input.kind], source: input.source,
      productKey: input.productKey, subject: input.subject ?? null, projectId: input.projectId ?? null,
      payload: safeJson(input.payload ?? { detail: input.detail }), sentiment: input.sentiment ?? 0, impact,
    },
  });
  await emit({ agent: "REALITY", action: "SIGNAL", detail: `${signalId} [${input.kind}/${impact}] ${input.productKey}: ${input.detail.slice(0, 90)}`, level: impact === "NEGATIVE" ? "WARNING" : "INFO", category: "SYSTEM" });
  return processSignalRow(signal.id, input.detail);
}

async function processSignalRow(rowId: string, detail: string): Promise<ProcessResult> {
  const s = await db.realitySignal.findUnique({ where: { id: rowId } });
  if (!s) throw new Error("signal not found");
  const kind = s.kind as SignalKind;
  const payload = safeParse(s.payload) as Record<string, unknown>;
  const generated: GeneratedItem[] = [];

  if (kind === "ERROR") {
    const taskId = await makeTask("QUALITY", "quality", `Fix reported error: ${detail}`, `Reality signal ${s.signalId} from ${s.productKey} (${s.source}): ${detail}. Diagnose and fix.`, "CRITICAL");
    generated.push({ kind: "TASK", id: taskId });
  } else if (kind === "FEEDBACK" && s.impact === "NEGATIVE") {
    const taskId = await makeTask("ENGINEERING", "engineering", `Address negative feedback: ${detail}`, `Reality signal ${s.signalId} from ${s.productKey}: users report "${detail}". Improve.`, "HIGH");
    generated.push({ kind: "TASK", id: taskId });
  } else if (kind === "FEATURE_REQUEST") {
    const taskId = await makeTask("GROWTH", "growth", `Evaluate feature request: ${detail}`, `Reality signal ${s.signalId} from ${s.productKey}: requested "${detail}". Assess demand & feasibility.`, "MEDIUM");
    generated.push({ kind: "TASK", id: taskId });
  } else if (kind === "USAGE" || kind === "RETENTION") {
    const metric = kind === "RETENTION" ? "retention" : "usage";
    const value = typeof payload.value === "number" ? payload.value : typeof payload.count === "number" ? payload.count : 1;
    const row = await db.growthMetric.create({ data: { projectId: s.projectId, metric, value, unit: String(payload.unit ?? "count"), period: String(payload.period ?? "daily") } });
    generated.push({ kind: "METRIC", id: row.id });
  } else if (kind === "CONVERSION") {
    const linked = s.subject ? await completeChannelExperiment(s.subject, payload, detail) : null;
    if (linked) generated.push({ kind: "EXPERIMENT", id: linked });
  }

  // Products → Genesis Memory.
  await getMemoryEngine().record({
    type: "EPISODIC", title: `Reality signal ${s.signalId}: ${kind} from ${s.productKey}`,
    content: `${detail}. Impact ${s.impact}. Generated: ${generated.map((g) => `${g.kind} ${g.id}`).join(", ") || "recorded"}.`,
    tags: ["reality", "feedback", kind.toLowerCase(), s.impact.toLowerCase()], importance: s.impact === "NEGATIVE" ? 8 : 6, source: `REALITY:${s.signalId}`,
  });

  await db.realitySignal.update({ where: { id: rowId }, data: { actedOn: true, processedAt: new Date(), generated: JSON.stringify(generated) } });
  const summary = generated.length ? `${kind} → ${generated.map((g) => `${g.kind} ${g.id}`).join(", ")}` : `${kind} recorded (no action needed)`;
  await emit({ agent: "REALITY", action: "PROCESSED", detail: `${s.signalId}: ${summary}`, level: "SUCCESS", category: "SYSTEM" });
  return { signalId: s.signalId!, kind, impact: s.impact, generated, summary };
}

/**
 * Close the acquisition boundary: a REAL conversion result completes the
 * subject's AWAITING_EXECUTION channel experiment with dataSource=REAL.
 */
async function completeChannelExperiment(subject: string, payload: Record<string, unknown>, detail: string): Promise<string | null> {
  const exp = await db.growthExperiment.findFirst({ where: { subject, kind: "CHANNEL", status: "AWAITING_EXECUTION" }, orderBy: { createdAt: "desc" } });
  if (!exp) return null;
  const conversions = typeof payload.conversions === "number" ? payload.conversions : undefined;
  const visitors = typeof payload.visitors === "number" ? payload.visitors : undefined;
  const rate = conversions !== undefined && visitors ? Math.round((conversions / visitors) * 1000) / 10 : undefined;
  const learning = `[REAL] Channel executed: ${detail}${rate !== undefined ? ` — ${conversions}/${visitors} converted (${rate}%)` : ""}. First real conversion data for this subject.`;
  await db.growthExperiment.update({
    where: { id: exp.id },
    data: { status: "LEARNED", dataSource: "REAL", learning, endDate: new Date(), result: JSON.stringify({ ...safeParse(exp.result) as object, real: { conversions, visitors, rate, detail } }), nextAction: "propose next channel experiment from real conversion data" },
  });
  await emit({ agent: "REALITY", action: "CHANNEL_MEASURED", detail: `${exp.experimentId} → LEARNED (REAL): ${rate !== undefined ? `${rate}% conversion` : detail.slice(0, 60)}`, level: "SUCCESS", category: "GROWTH" });
  return exp.experimentId ?? exp.id;
}

/** Re-process any signals that failed to act (e.g. after a crash). */
export async function processPending(limit = 50): Promise<ProcessResult[]> {
  const pending = await db.realitySignal.findMany({ where: { actedOn: false, signalId: { not: null } }, orderBy: { createdAt: "asc" }, take: limit });
  const out: ProcessResult[] = [];
  for (const s of pending) {
    const detail = (safeParse(s.payload) as { detail?: string })?.detail ?? s.source;
    out.push(await processSignalRow(s.id, detail));
  }
  return out;
}

function safeJson(v: unknown): string { try { const s = JSON.stringify(v); return s.length > 20_000 ? s.slice(0, 20_000) : s; } catch { return "{}"; } }
function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return {}; } }
