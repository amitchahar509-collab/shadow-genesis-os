/** V11 — Architecture Engine (Phase 2).
 *
 * Turns a RequirementsDoc into a REASONED architecture: for each component
 * (frontend, backend, database, auth, storage, queue, caching, deployment) a
 * specific technology choice OR "none" — each justified from the requirements,
 * NOT a fixed stack. Plus external APIs, a project structure, and modules.
 *
 * Honesty contract mirrors Phase 1: mode="LLM" is reasoned per requirements;
 * mode="HEURISTIC" derives from the requirements' own shape (entities, users,
 * NFRs) when no model is available — never a fixed template. A CLI gets no
 * database/frontend/auth; a multi-role data app gets all three.
 *
 * Additive: does not touch the template pipeline.
 */
import { callLlmRouted } from "../router";
import { parseJsonResponse } from "../types";
import { db } from "@/lib/db";
import type { RequirementsDoc } from "../requirements";

export interface TechChoice { area: string; choice: string; rationale: string }
export interface ProjectPath { path: string; purpose: string }
export interface ArchModule { name: string; responsibility: string }

export interface ArchitectureDoc {
  goal: string;
  specId?: string;
  summary: string;
  frontend: TechChoice;
  backend: TechChoice;
  database: TechChoice;
  authentication: TechChoice;
  storage: TechChoice;
  queue: TechChoice;
  caching: TechChoice;
  externalApis: TechChoice[];
  deployment: TechChoice;
  projectStructure: ProjectPath[];
  modules: ArchModule[];
  mode: "LLM" | "HEURISTIC";
}

type Invoke = Parameters<typeof callLlmRouted>[1]["_invoke"];

const AREAS = ["frontend", "backend", "database", "authentication", "storage", "queue", "caching", "deployment"] as const;

const SYSTEM = [
  "You are a principal software architect. Given a requirements document, decide the architecture.",
  "For EACH area (frontend, backend, database, authentication, storage, queue, caching, deployment) pick a specific technology",
  'OR the literal string "none" when the requirements do NOT need it (e.g. a CLI needs no frontend/database/auth; a simple app needs no queue).',
  "Every choice needs a one-sentence rationale grounded in the requirements (entities, users, non-functional needs, constraints).",
  "Do NOT default to a fixed stack — justify from the requirements. Also list external APIs, the project folder structure, and the modules.",
  "Respond with ONLY JSON:",
  '{"summary":"","frontend":{"choice":"","rationale":""},"backend":{"choice":"","rationale":""},"database":{"choice":"","rationale":""},"authentication":{"choice":"","rationale":""},"storage":{"choice":"","rationale":""},"queue":{"choice":"","rationale":""},"caching":{"choice":"","rationale":""},"externalApis":[{"choice":"","rationale":""}],"deployment":{"choice":"","rationale":""},"projectStructure":[{"path":"","purpose":""}],"modules":[{"name":"","responsibility":""}]}',
].join(" ");

function choice(area: string, v: unknown): TechChoice {
  const o = (v ?? {}) as Record<string, unknown>;
  return { area, choice: String(o.choice ?? "none").trim() || "none", rationale: String(o.rationale ?? "").trim() };
}
function choiceList(v: unknown): TechChoice[] {
  if (!Array.isArray(v)) return [];
  return v.map((x, i) => choice(`external-${i}`, x)).filter((c) => c.choice && c.choice !== "none").slice(0, 15);
}
function paths(v: unknown): ProjectPath[] {
  if (!Array.isArray(v)) return [];
  return v.map((p) => { const o = (p ?? {}) as Record<string, unknown>; return { path: String(o.path ?? "").trim(), purpose: String(o.purpose ?? "").trim() }; }).filter((p) => p.path).slice(0, 40);
}
function modules(v: unknown): ArchModule[] {
  if (!Array.isArray(v)) return [];
  return v.map((m) => { const o = (m ?? {}) as Record<string, unknown>; return { name: String(o.name ?? "").trim(), responsibility: String(o.responsibility ?? "").trim() }; }).filter((m) => m.name).slice(0, 40);
}

/** Requirements-derived fallback: reads the doc's shape to decide components.
 *  Never a fixed template — a CLI and a multi-role data app diverge here. */
export function heuristicArchitecture(req: RequirementsDoc): ArchitectureDoc {
  const text = JSON.stringify(req).toLowerCase();
  const hasEntities = req.dataEntities.length > 0;
  const isCli = /\bcli\b|command.?line|terminal/.test(text) && !/\b(web|dashboard|ui|frontend|website|portal)\b/.test(text);
  const multiUser = req.targetUsers.length > 1 || /role|permission|admin|login|account|auth/.test(text);
  const needsScale = /scale|high.throughput|concurrent|thousands|millions|real.?time|hipaa|compliance|pci/.test(text);
  const none = (area: string, why: string): TechChoice => ({ area, choice: "none", rationale: why });

  const frontend: TechChoice = isCli ? none("frontend", "CLI/terminal tool — no UI required.")
    : { area: "frontend", choice: "Next.js (React)", rationale: `Interactive users (${req.targetUsers.join(", ") || "end users"}) need a UI.` };
  const backend: TechChoice = isCli ? { area: "backend", choice: "Node CLI", rationale: "Runs as a command-line program." }
    : { area: "backend", choice: "Node HTTP API", rationale: "Serves the data operations the features require." };
  const database: TechChoice = !hasEntities ? none("database", "No persistent data entities in the requirements.")
    : needsScale ? { area: "database", choice: "PostgreSQL", rationale: "Requirements imply scale/compliance; a server DB is warranted." }
      : { area: "database", choice: "SQLite (Prisma)", rationale: `Persists ${req.dataEntities.length} entity type(s) at small scale.` };
  const authentication: TechChoice = (multiUser && hasEntities && !isCli) ? { area: "authentication", choice: "Session auth (credentials)", rationale: "Multiple user roles require access control." }
    : none("authentication", "Single-user or no roles — auth not required.");
  const storage = /file|upload|image|document|attachment|photo|pdf/.test(text) ? { area: "storage", choice: "Local/object file storage", rationale: "Requirements mention file/media handling." } : none("storage", "No file/media handling in the requirements.");
  const queue = /queue|background|async job|email send|notification|schedul/.test(text) && needsScale ? { area: "queue", choice: "Job queue", rationale: "Background/async work at scale." } : none("queue", "No background/async workload requiring a queue.");
  const caching = needsScale ? { area: "caching", choice: "In-memory cache", rationale: "Scale/latency NFRs benefit from caching." } : none("caching", "Small scale — no caching layer needed yet.");
  const deployment: TechChoice = isCli ? { area: "deployment", choice: "npm package / local run", rationale: "CLI distribution." } : { area: "deployment", choice: "Local server (Genesis-managed)", rationale: "Runs as a local service; cloud optional later." };

  const structure: ProjectPath[] = isCli
    ? [{ path: "src/", purpose: "CLI source" }, { path: "src/core.*", purpose: "domain logic" }, { path: "tests/", purpose: "tests" }]
    : [{ path: "src/", purpose: "application source" }, ...(hasEntities ? [{ path: "prisma/", purpose: "database schema" }] : []), { path: "src/api/", purpose: "backend routes" }, ...(frontend.choice !== "none" ? [{ path: "src/app/", purpose: "frontend pages" }] : []), { path: "tests/", purpose: "tests" }];
  const mods: ArchModule[] = req.dataEntities.map((e) => ({ name: `${e.name} module`, responsibility: `Manage ${e.name} (${e.fields.slice(0, 4).join(", ")})` }));
  if (!mods.length) mods.push({ name: "core", responsibility: "Primary domain logic derived from the goal." });

  return {
    goal: req.goal, summary: `Heuristic architecture derived from ${req.dataEntities.length} entity type(s) and ${req.targetUsers.length} user role(s).`,
    frontend, backend, database, authentication, storage, queue, caching, externalApis: [], deployment,
    projectStructure: structure, modules: mods, mode: "HEURISTIC",
  };
}

/** Derive an architecture from a requirements document, via reasoning. */
export async function deriveArchitecture(req: RequirementsDoc, opts?: { invoke?: Invoke; timeoutMs?: number }): Promise<ArchitectureDoc> {
  const user = [
    `Goal: ${req.goal}`,
    `Purpose: ${req.purpose}`,
    `Target users: ${req.targetUsers.join(", ")}`,
    `Core features: ${req.coreFeatures.join("; ")}`,
    `Data entities: ${req.dataEntities.map((e) => `${e.name}(${e.fields.join(",")})`).join("; ") || "none"}`,
    `Business rules: ${req.businessRules.join("; ")}`,
    `Non-functional: ${req.nonFunctional.join("; ")}`,
    `Constraints: ${req.constraints.join("; ")}`,
  ].join("\n");
  const r = await callLlmRouted(
    { system: SYSTEM, user, temperature: 0.3, maxTokens: 2000, timeoutMs: opts?.timeoutMs ?? 20_000 },
    { agent: "ARCHITECT", importance: "CRITICAL", _invoke: opts?.invoke },
  );
  const parsed = r.ok ? (parseJsonResponse(r.text) as Record<string, unknown> | null) : null;
  if (!parsed) return heuristicArchitecture(req);
  const doc: ArchitectureDoc = {
    goal: req.goal,
    summary: String(parsed.summary ?? "").trim(),
    frontend: choice("frontend", parsed.frontend),
    backend: choice("backend", parsed.backend),
    database: choice("database", parsed.database),
    authentication: choice("authentication", parsed.authentication),
    storage: choice("storage", parsed.storage),
    queue: choice("queue", parsed.queue),
    caching: choice("caching", parsed.caching),
    externalApis: choiceList(parsed.externalApis),
    deployment: choice("deployment", parsed.deployment),
    projectStructure: paths(parsed.projectStructure),
    modules: modules(parsed.modules),
    mode: "LLM",
  };
  // A valid architecture must decide at least the backend + structure/modules.
  if (!doc.backend.choice || (doc.modules.length === 0 && doc.projectStructure.length === 0)) return heuristicArchitecture(req);
  return doc;
}

async function nextArchId(): Promise<string> {
  const last = await db.architectureSpec.findFirst({ orderBy: { createdAt: "desc" }, select: { archId: true } }).catch(() => null);
  const n = last?.archId?.match(/ARCH-(\d+)/)?.[1];
  return `ARCH-${String((n ? parseInt(n, 10) : 0) + 1).padStart(6, "0")}`;
}

/** Derive + persist an architecture spec linked to its requirements. */
export async function runArchitecture(req: RequirementsDoc, opts?: { invoke?: Invoke; specId?: string; projectId?: string; persist?: boolean }): Promise<{ archId: string; doc: ArchitectureDoc }> {
  const doc = await deriveArchitecture(req, { invoke: opts?.invoke });
  doc.specId = opts?.specId;
  const archId = await nextArchId();
  if (opts?.persist !== false) {
    await db.architectureSpec.create({
      data: { archId, specId: opts?.specId ?? null, goal: doc.goal, mode: doc.mode, summary: doc.summary, doc: JSON.stringify(doc), moduleCount: doc.modules.length, projectId: opts?.projectId ?? null },
    }).catch(() => {});
  }
  return { archId, doc };
}

export { AREAS };
