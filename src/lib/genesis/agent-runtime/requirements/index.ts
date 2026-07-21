/** V11 — Requirements Engine (Phase 1).
 *
 * Turns a raw goal ("build X") into a FORMAL, goal-DERIVED requirements document
 * BEFORE any code is planned or written. This is the first step in replacing
 * template generation with reasoning: the document below is what later phases
 * (architecture, planning, codegen) consume.
 *
 * Honesty contract:
 *  - mode="LLM": every field is reasoned by the model from THIS goal. Two
 *    different goals produce genuinely different documents.
 *  - mode="HEURISTIC": the model was unavailable; we still derive a *weaker*
 *    document from the goal text itself (never a fixed template) and label it
 *    HEURISTIC so nothing is faked.
 *
 * Additive: this module does NOT touch the template pipeline. It is a new
 * capability, wired to its own API + DB table. Genesis keeps working unchanged.
 */
import { callLlmRouted } from "../router";
import { parseJsonResponse } from "../types";
import { db } from "@/lib/db";

export interface DataEntity { name: string; fields: string[]; description?: string }
export interface UserJourney { actor: string; steps: string[] }

export interface RequirementsDoc {
  goal: string;
  purpose: string;
  targetUsers: string[];
  coreFeatures: string[];
  optionalFeatures: string[];
  dataEntities: DataEntity[];
  businessRules: string[];
  userJourneys: UserJourney[];
  nonFunctional: string[];
  constraints: string[];
  successCriteria: string[];
  mode: "LLM" | "HEURISTIC";
}

// The test seam mirrors callLlmRouted's `_invoke`: (provider, opts, timeoutMs) => {text,...}
type Invoke = Parameters<typeof callLlmRouted>[1]["_invoke"];

const SYSTEM = [
  "You are a senior product analyst. Given ONLY a build goal, derive a complete, goal-SPECIFIC requirements document.",
  "Do NOT invent a generic CRUD app. The entities, features, rules and journeys MUST reflect the actual domain of the goal",
  "(e.g. a hospital system has Patient/Doctor/Appointment/Prescription; a POS has Order/MenuItem/Payment/Table).",
  "Respond with ONLY JSON matching exactly:",
  '{"purpose":"","targetUsers":[""],"coreFeatures":[""],"optionalFeatures":[""],"dataEntities":[{"name":"","fields":[""],"description":""}],"businessRules":[""],"userJourneys":[{"actor":"","steps":[""]}],"nonFunctional":[""],"constraints":[""],"successCriteria":[""]}',
].join(" ");

function asStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === "string" ? x : typeof x === "object" && x ? JSON.stringify(x) : String(x))).filter(Boolean).slice(0, 30);
}
function asEntities(v: unknown): DataEntity[] {
  if (!Array.isArray(v)) return [];
  return v.map((e) => {
    const o = (e ?? {}) as Record<string, unknown>;
    return { name: String(o.name ?? "").trim(), fields: asStrings(o.fields), description: o.description ? String(o.description) : undefined };
  }).filter((e) => e.name).slice(0, 30);
}
function asJourneys(v: unknown): UserJourney[] {
  if (!Array.isArray(v)) return [];
  return v.map((j) => {
    const o = (j ?? {}) as Record<string, unknown>;
    return { actor: String(o.actor ?? "").trim() || "User", steps: asStrings(o.steps) };
  }).filter((j) => j.steps.length).slice(0, 20);
}

/** Goal-derived fallback when no model is available — weaker, but never a fixed
 *  template. Pulls candidate nouns from the goal so the doc still reflects it. */
export function heuristicRequirements(goal: string): RequirementsDoc {
  const g = goal.trim();
  const words = g.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const stop = new Set(["build", "a", "an", "the", "for", "with", "and", "or", "to", "of", "in", "on", "app", "application", "system", "platform", "software", "tool", "that", "which", "using"]);
  const keywords = [...new Set(words.filter((w) => w.length > 2 && !stop.has(w)))];
  const primary = keywords[0] ? keywords[0][0].toUpperCase() + keywords[0].slice(1) : "Record";
  return {
    goal: g,
    purpose: `Deliver the software described by the goal: "${g}".`,
    targetUsers: ["End user", "Administrator"],
    coreFeatures: keywords.slice(0, 5).map((k) => `Manage ${k}`),
    optionalFeatures: [],
    dataEntities: [{ name: primary, fields: ["id", "name", "createdAt", "status"], description: `Primary entity inferred from the goal keyword "${keywords[0] ?? "record"}".` }],
    businessRules: [],
    userJourneys: [{ actor: "End user", steps: [`Open the app`, `Work with ${keywords[0] ?? "records"}`, `See results`] }],
    nonFunctional: ["Must build and run", "Basic input validation"],
    constraints: ["Derived without an LLM — coarse; enable a provider for full reasoning"],
    successCriteria: ["App builds", "Core feature reachable"],
    mode: "HEURISTIC",
  };
}

/** Derive a requirements document from a goal. Uses the reasoning router;
 *  falls back to the goal-derived heuristic if the model is unavailable. */
export async function deriveRequirements(goal: string, opts?: { invoke?: Invoke; timeoutMs?: number }): Promise<RequirementsDoc> {
  const g = goal.trim();
  if (!g) throw new Error("goal required");
  const r = await callLlmRouted(
    { system: SYSTEM, user: `Goal: ${g}`, temperature: 0.3, maxTokens: 1800, timeoutMs: opts?.timeoutMs ?? 20_000 },
    { agent: "ARCHITECT", importance: "CRITICAL", _invoke: opts?.invoke },
  );
  const parsed = r.ok ? (parseJsonResponse(r.text) as Record<string, unknown> | null) : null;
  if (!parsed) return heuristicRequirements(g);
  const doc: RequirementsDoc = {
    goal: g,
    purpose: String(parsed.purpose ?? "").trim() || heuristicRequirements(g).purpose,
    targetUsers: asStrings(parsed.targetUsers),
    coreFeatures: asStrings(parsed.coreFeatures),
    optionalFeatures: asStrings(parsed.optionalFeatures),
    dataEntities: asEntities(parsed.dataEntities),
    businessRules: asStrings(parsed.businessRules),
    userJourneys: asJourneys(parsed.userJourneys),
    nonFunctional: asStrings(parsed.nonFunctional),
    constraints: asStrings(parsed.constraints),
    successCriteria: asStrings(parsed.successCriteria),
    mode: "LLM",
  };
  // A valid LLM doc must carry real domain content — else fall back honestly.
  if (doc.dataEntities.length === 0 && doc.coreFeatures.length === 0) return heuristicRequirements(g);
  return doc;
}

async function nextSpecId(): Promise<string> {
  const last = await db.requirementSpec.findFirst({ orderBy: { createdAt: "desc" }, select: { specId: true } }).catch(() => null);
  const n = last?.specId?.match(/REQ-(\d+)/)?.[1];
  return `REQ-${String((n ? parseInt(n, 10) : 0) + 1).padStart(6, "0")}`;
}

/** Derive + persist a requirements spec. Returns the row id + the document. */
export async function runRequirements(goal: string, opts?: { invoke?: Invoke; projectId?: string; persist?: boolean }): Promise<{ specId: string; doc: RequirementsDoc }> {
  const doc = await deriveRequirements(goal, { invoke: opts?.invoke });
  const specId = await nextSpecId();
  if (opts?.persist !== false) {
    await db.requirementSpec.create({
      data: {
        specId, goal: doc.goal, mode: doc.mode, purpose: doc.purpose, doc: JSON.stringify(doc),
        entityCount: doc.dataEntities.length, featureCount: doc.coreFeatures.length, projectId: opts?.projectId ?? null,
      },
    }).catch(() => {});
  }
  return { specId, doc };
}
