/** TemplateAgent — makes installed AGENT plugins EXECUTABLE (V8 G7→G11→runtime).
 *
 * An evolution-created (or user-created) AgentTemplate row becomes a runnable
 * specialist: its systemPrompt drives a real routed LLM call and the execution
 * lands in AgentExecution under the template key — which is exactly what the
 * marketplace's refreshStats and the evolution engine already read. The whole
 * flywheel closes: evolve → publish → install → RUN → real stats → re-evolve.
 *
 * Honesty rules:
 *  - resolution is gated on the marketplace: only an INSTALLED plugin runs.
 *    LISTED means "on the shelf", DEPRECATED means "withdrawn" — neither executes.
 *  - a specialist IS its prompt: if no model is reachable the run FAILS honestly
 *    (no heuristic stand-in that would fake specialist output).
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { db } from "@/lib/db";
import { BaseAgent, type AgentRunInput, type AgentRunContext } from "../base-agent";
import { AGENT_REGISTRY } from "./index";

export interface TemplateRow { key: string; name: string; description: string; systemPrompt: string; toolAllowlist: string; defaultContext: string }

export class TemplateAgent extends BaseAgent {
  readonly name: string;
  readonly department = "specialist";
  readonly description: string;
  private readonly template: TemplateRow;

  constructor(template: TemplateRow) {
    super();
    this.template = template;
    this.name = template.key.toUpperCase();
    this.description = template.description;
  }

  protected async run(input: AgentRunInput, ctx: AgentRunContext) {
    let defaults: Record<string, unknown> = {};
    try { defaults = JSON.parse(this.template.defaultContext); } catch { /* keep {} */ }
    const context = { ...defaults, ...(input.context ?? {}) };
    const contextBlock = Object.keys(context).length ? `\n\nContext:\n${JSON.stringify(context, null, 2)}` : "";

    const r = await ctx.llm(
      `${this.template.systemPrompt}\n\nYou are running as the "${this.template.name}" specialist. Produce a concise, actionable markdown report: findings first, then concrete recommendations. Never invent data — if something is unknown, say so.`,
      `Mission: ${input.goal}${contextBlock}`,
      { temperature: 0.4, maxTokens: 1200, timeoutMs: input.timeoutMs ?? 20_000 },
    );
    if (!r.ok) throw new Error(`specialist has no reachable model (${r.error ?? "LLM failed"}) — refusing to fake specialist output`);

    const reportPath = path.join(ctx.sandboxRoot, "SPECIALIST_REPORT.md");
    await fs.writeFile(reportPath, `# ${this.template.name} — Specialist Report\n\n**Mission:** ${input.goal}\n**Mode:** REAL LLM\n\n${r.text}\n`, "utf8");
    const stat = await fs.stat(reportPath);
    await ctx.recordMemory({ type: "EPISODIC", title: `${this.name} specialist run`, content: r.text.slice(0, 500), tags: [this.name.toLowerCase(), "specialist"], importance: 6 });
    return {
      summary: `${this.template.name}: report produced (${r.text.length} chars, real LLM)`,
      artifacts: [{ type: "FILE", path: reportPath, description: "Specialist report", size: stat.size }],
      output: { report: r.text, mode: "LLM", toolAllowlist: JSON.parse(this.template.toolAllowlist || "[]") as string[] },
    };
  }
}

export type ResolveResult = { ok: true; agent: BaseAgent; kind: "BUILTIN" | "TEMPLATE" } | { ok: false; error: string; status: number };

/** Resolve ANY executable agent: builtins run as always (they ARE the OS); a
 *  template runs only when its marketplace plugin is INSTALLED. */
export async function resolveExecutableAgent(name: string): Promise<ResolveResult> {
  const upper = name.toUpperCase();
  const Ctor = AGENT_REGISTRY[upper];
  if (Ctor) return { ok: true, agent: new Ctor(), kind: "BUILTIN" };

  const template = await db.agentTemplate.findFirst({ where: { OR: [{ key: name }, { key: upper }] } });
  if (!template) return { ok: false, error: `unknown agent: ${name}`, status: 404 };

  const plugin = await db.plugin.findUnique({ where: { kind_refKey: { kind: "AGENT", refKey: template.key } } });
  if (!plugin) return { ok: false, error: `template "${template.key}" is not listed on the marketplace — publish it first`, status: 409 };
  if (plugin.status === "DEPRECATED") return { ok: false, error: `plugin ${plugin.pluginId} is deprecated — withdrawn specialists do not run`, status: 410 };
  if (plugin.status !== "INSTALLED") return { ok: false, error: `plugin ${plugin.pluginId} is ${plugin.status} — install it to make the specialist executable`, status: 409 };

  return { ok: true, agent: new TemplateAgent(template), kind: "TEMPLATE" };
}
