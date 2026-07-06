/** Prompt versioning (V3 Phase 6). */

import { db } from "@/lib/db";
import { emit, events } from "../event-bus";

export interface PromptVersion {
  id: string; agent: string; version: number; systemPrompt: string;
  notes: string | null; active: boolean; successCount: number; failCount: number; createdAt: Date;
}

const DEFAULT_PROMPTS: Record<string, string> = {
  CEO: `You are the CEO of an autonomous AI company. Decompose the goal into 3-7 ordered tasks. Each task: title, description, ownerAgent, department, priority, dependencies, expectedArtifact, validation, estimatedHours. Respond ONLY with JSON: {"rationale":"…","tasks":[{…}]}.`,
  RESEARCH: `You are the Research agent. Search the web, fetch sources, synthesize findings. Cite URLs.`,
  ARCHITECT: `You are the Architect. Produce a concise architecture document in Markdown.`,
  ENGINEERING: `You are the Engineering agent. Build, install, test, repair. Use bun/npm. Report exit codes honestly.`,
  DESIGN: `You are the Design agent. Produce design system: palette, tokens, components, accessibility.`,
  GROWTH: `You are the Growth agent. Produce a JSON growth plan: positioning + 3 channels with KPIs.`,
  QUALITY: `You are the Quality agent. Scan for security issues, generate tests, run tests, repair.`,
  DEPLOYMENT: `You are the Deployment agent. Detect build, validate env, deploy, monitor health, rollback.`,
  SECURITY: `You are the Security agent. Scan source, deps, configs. Block releases with CRITICAL findings.`,
  OPPORTUNITY: `You are the Opportunity agent. Discover market opportunities. Output JSON: {opportunities:[{title,problem,market,targetUsers,difficulty,potentialValue,evidence}]}.`,
  REVENUE: `You are the Revenue agent. Design pricing models + business models. Output JSON: {model,pricing,forecast,channels}.`,
  INTERNET: `You are the Internet Operator agent. Navigate the web, extract information, fill forms. Always log actions for audit.`,
};

export async function getActivePrompt(agent: string): Promise<PromptVersion | null> {
  const upper = agent.toUpperCase();
  const existing = await db.promptVersion.findFirst({ where: { agent: upper, active: true }, orderBy: { version: "desc" } });
  if (existing) return rowToRecord(existing);
  const def = DEFAULT_PROMPTS[upper];
  if (!def) return null;
  return await setPrompt(upper, def, "default seeded prompt");
}

export async function setPrompt(agent: string, systemPrompt: string, notes?: string): Promise<PromptVersion> {
  const upper = agent.toUpperCase();
  const last = await db.promptVersion.findFirst({ where: { agent: upper }, orderBy: { version: "desc" }, select: { version: true } });
  const nextVersion = (last?.version ?? 0) + 1;
  await db.promptVersion.updateMany({ where: { agent: upper, active: true }, data: { active: false } });
  const created = await db.promptVersion.create({ data: { agent: upper, version: nextVersion, systemPrompt, notes: notes ?? null, active: true } });
  await emit(events.memory("PROMPT", `set ${upper} prompt to v${nextVersion}`));
  return rowToRecord(created);
}

export async function activateVersion(id: string): Promise<PromptVersion | null> {
  const target = await db.promptVersion.findUnique({ where: { id } });
  if (!target) return null;
  await db.promptVersion.updateMany({ where: { agent: target.agent, active: true }, data: { active: false } });
  return rowToRecord(await db.promptVersion.update({ where: { id }, data: { active: true } }));
}

export async function recordOutcome(id: string, success: boolean): Promise<void> {
  const row = await db.promptVersion.findUnique({ where: { id } });
  if (!row) return;
  await db.promptVersion.update({ where: { id }, data: success ? { successCount: row.successCount + 1 } : { failCount: row.failCount + 1 } });
}

export async function listVersions(agent: string): Promise<PromptVersion[]> {
  return (await db.promptVersion.findMany({ where: { agent: agent.toUpperCase() }, orderBy: { version: "desc" } })).map(rowToRecord);
}

export async function rollback(agent: string): Promise<PromptVersion | null> {
  const versions = await db.promptVersion.findMany({ where: { agent: agent.toUpperCase() }, orderBy: { version: "desc" } });
  if (versions.length < 2) return null;
  return await activateVersion(versions[1].id);
}

function rowToRecord(row: { id: string; agent: string; version: number; systemPrompt: string; notes: string | null; active: boolean; successCount: number; failCount: number; createdAt: Date; }): PromptVersion {
  return { id: row.id, agent: row.agent, version: row.version, systemPrompt: row.systemPrompt, notes: row.notes, active: row.active, successCount: row.successCount, failCount: row.failCount, createdAt: row.createdAt };
}
