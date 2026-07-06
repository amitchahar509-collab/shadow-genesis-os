/** BaseAgent — runtime contract for every executable agent. */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { db } from "@/lib/db";
import { getMemoryEngine } from "./memory/engine";
import { invokeTool } from "./tools";
import type { ToolContext, ToolOutput } from "./tools/index";
import { emit, events } from "./event-bus";

export interface AgentRunInput {
  goal: string;
  taskId?: string;
  projectId?: string;
  parentExecutionId?: string;
  context?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface AgentRunResult {
  executionId: string;
  status: "SUCCESS" | "FAILED";
  summary: string;
  artifacts: { type: string; path: string; description: string; size: number }[];
  metrics: { toolCalls: number; durationMs: number; tokensUsed: number; retries: number; };
  output: Record<string, unknown>;
  error?: string;
}

export abstract class BaseAgent {
  abstract readonly name: string;
  abstract readonly department: string;
  readonly description: string = "";
  protected sandboxRoot = "";
  protected executionId = "";
  protected abstract run(input: AgentRunInput, ctx: AgentRunContext): Promise<{ summary: string; artifacts: { type: string; path: string; description: string; size: number }[]; output: Record<string, unknown>; }>;

  async execute(input: AgentRunInput): Promise<AgentRunResult> {
    const execNum = await nextExecutionNumber();
    this.executionId = `EX-${execNum.toString().padStart(6, "0")}`;
    const sandbox = path.resolve(process.cwd(), ".genesis-workspace", this.name.toLowerCase(), this.executionId);
    await fs.mkdir(sandbox, { recursive: true });
    this.sandboxRoot = sandbox;

    await db.agentExecution.create({ data: { executionId: this.executionId, agent: this.name, taskId: input.taskId ?? null, projectId: input.projectId ?? null, goal: input.goal, status: "RUNNING", startedAt: new Date(), parentExecutionId: input.parentExecutionId ?? null } });

    const start = Date.now();
    let toolCalls = 0, tokensUsed = 0, retries = 0;

    const ctx: AgentRunContext = {
      executionId: this.executionId,
      sandboxRoot: sandbox,
      projectId: input.projectId,
      recall: async (query: string, tags?: string[]) => (await getMemoryEngine().recall({ query, tags, limit: 5 })),
      recordMemory: async (params) => getMemoryEngine().record({ ...params, source: params.source ?? `${this.name}:${this.executionId}` }),
      similarMissions: async (goal: string) => getMemoryEngine().similarMissions(goal),
      tool: async (name: string, operation: string, toolInput: Record<string, unknown>) => {
        toolCalls++;
        const tCtx: ToolContext = { executionId: this.executionId, agent: this.name, sandboxRoot: sandbox, timeoutMs: 60_000 };
        const t0 = Date.now();
        const out: ToolOutput = await invokeTool(name, operation, toolInput, tCtx);
        const durationMs = Date.now() - t0;
        await db.toolCall.create({ data: { executionId: this.executionId, tool: name, operation, input: truncateJson(toolInput), output: truncateJson(out.result ?? { ok: out.ok, summary: out.summary }), status: out.ok ? "SUCCESS" : "ERROR", durationMs, errorMessage: out.error ?? null } });
        await emit(events.tool(this.name, this.executionId, `${name}.${operation} → ${out.summary}`, out.ok ? "INFO" : "WARNING"));
        return out;
      },
      emit: async (event) => {
        await emit({ agent: this.name, action: event.action, detail: event.detail, level: event.level ?? "INFO", category: event.category ?? "SYSTEM", taskId: input.taskId ?? null, executionId: this.executionId });
      },
      retry: async <T,>(fn: () => Promise<T>, attempts = 3): Promise<T> => {
        let lastErr: unknown;
        for (let i = 0; i < attempts; i++) {
          try { return await fn(); }
          catch (e) { lastErr = e; retries++; await emit(events.error(this.name, `retry ${i + 1}/${attempts}: ${e instanceof Error ? e.message : String(e)}`)); await new Promise((r) => setTimeout(r, 500 * (i + 1))); }
        }
        throw lastErr;
      },
      llm: async (system: string, user: string, opts?: { temperature?: number; maxTokens?: number; timeoutMs?: number; }) => {
        const { callLlm } = await import("./types");
        const r = await callLlm({ system, user, temperature: opts?.temperature, maxTokens: opts?.maxTokens, timeoutMs: opts?.timeoutMs ?? 8_000 });
        if (r.tokensUsed) tokensUsed += r.tokensUsed;
        return r;
      },
    };

    try {
      await ctx.emit({ action: "START", detail: `${this.name} starting: ${truncate(input.goal, 120)}`, level: "INFO" });
      await ctx.recordMemory({ type: "EPISODIC", title: `${this.name} run started`, content: `Goal: ${input.goal}\nExecution: ${this.executionId}\nSandbox: ${sandbox}`, tags: [this.name.toLowerCase(), "execution", "start"], importance: 5 });

      const result = await this.run(input, ctx);
      const durationMs = Date.now() - start;

      let artifactsCreated = 0;
      for (const a of result.artifacts) {
        const checksum = await sha256OfFile(a.path).catch(() => null);
        await db.artifact.create({ data: { executionId: this.executionId, taskId: input.taskId ?? null, projectId: input.projectId ?? null, type: a.type, path: a.path, description: a.description, size: a.size, checksum, metadata: JSON.stringify({ agent: this.name }) } });
        artifactsCreated++;
        await ctx.emit({ action: "ARTIFACT", detail: `created ${a.type}: ${a.path} (${a.size}b)`, level: "SUCCESS" });
      }

      await db.agentExecution.update({ where: { executionId: this.executionId }, data: { status: "SUCCESS", completedAt: new Date(), durationMs, toolCalls, artifactsCreated, retryCount: retries, tokensUsed, result: JSON.stringify({ summary: result.summary, output: result.output }) } });
      await ctx.recordMemory({ type: "EPISODIC", title: `${this.name} run succeeded: ${truncate(result.summary, 80)}`, content: `Goal: ${input.goal}\nResult: ${result.summary}\nDuration: ${durationMs}ms\nTools: ${toolCalls}\nArtifacts: ${artifactsCreated}`, tags: [this.name.toLowerCase(), "execution", "success"], importance: 7 });
      await ctx.emit({ action: "SUCCESS", detail: truncate(result.summary, 160), level: "SUCCESS" });

      // Trigger post-execution analyzer (async, don't block)
      import("./improvement/analyzer").then(({ analyzeExecution }) => analyzeExecution(this.executionId).catch(() => {})).catch(() => {});

      return { executionId: this.executionId, status: "SUCCESS", summary: result.summary, artifacts: result.artifacts, metrics: { toolCalls, durationMs, tokensUsed, retries }, output: result.output };
    } catch (e) {
      const durationMs = Date.now() - start;
      const errorMessage = e instanceof Error ? e.message : String(e);
      await db.agentExecution.update({ where: { executionId: this.executionId }, data: { status: "FAILED", completedAt: new Date(), durationMs, toolCalls, retryCount: retries, tokensUsed, error: errorMessage, result: JSON.stringify({ error: errorMessage }) } });
      await ctx.recordMemory({ type: "EPISODIC", title: `${this.name} run FAILED: ${truncate(errorMessage, 80)}`, content: `Goal: ${input.goal}\nError: ${errorMessage}\nDuration: ${durationMs}ms`, tags: [this.name.toLowerCase(), "execution", "failure", "error"], importance: 9 });
      await emit(events.error(this.name, `FAILED: ${truncate(errorMessage, 160)}`));
      return { executionId: this.executionId, status: "FAILED", summary: errorMessage, artifacts: [], metrics: { toolCalls, durationMs, tokensUsed, retries }, output: {}, error: errorMessage };
    }
  }
}

export interface AgentRunContext {
  executionId: string;
  sandboxRoot: string;
  projectId?: string;
  recall(query: string, tags?: string[]): Promise<unknown[]>;
  recordMemory(params: { type: "EPISODIC" | "SEMANTIC" | "PROCEDURAL"; title: string; content: string; tags?: string[]; importance?: number; source?: string; }): Promise<unknown>;
  similarMissions(goal: string): Promise<unknown[]>;
  tool(name: string, operation: string, input: Record<string, unknown>): Promise<ToolOutput>;
  emit(event: { action: string; detail: string; level?: "INFO" | "SUCCESS" | "WARNING" | "ERROR" | "CRITICAL"; category?: "TASK" | "BUILD" | "TEST" | "DEPLOY" | "SECURITY" | "MEMORY" | "DECISION" | "RESEARCH" | "TOOL" | "SYSTEM" | "OPPORTUNITY" | "REVENUE" | "GROWTH"; }): Promise<void>;
  retry<T>(fn: () => Promise<T>, attempts?: number): Promise<T>;
  llm(system: string, user: string, opts?: { temperature?: number; maxTokens?: number; timeoutMs?: number; }): Promise<{ ok: boolean; text: string; error?: string; durationMs: number; }>;
}

async function nextExecutionNumber(): Promise<number> {
  const last = await db.agentExecution.findFirst({ orderBy: { executionId: "desc" }, select: { executionId: true } });
  if (!last) return 1;
  const m = last.executionId.match(/^EX-(\d+)$/);
  return m ? parseInt(m[1], 10) + 1 : 1;
}

function truncate(s: string, n: number): string { return s.length > n ? s.slice(0, n - 1) + "…" : s; }
function truncateJson(v: unknown): string { try { const s = JSON.stringify(v); return s.length > 16_000 ? s.slice(0, 16_000) + "…[truncated]" : s; } catch { return String(v).slice(0, 16_000); } }
async function sha256OfFile(p: string): Promise<string | null> {
  try { const { createHash } = await import("node:crypto"); const { readFile } = await import("node:fs/promises"); const buf = await readFile(p); return createHash("sha256").update(buf).digest("hex"); } catch { return null; }
}
