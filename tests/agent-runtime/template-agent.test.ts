/** TemplateAgent — installed AGENT plugins become EXECUTABLE (evolve → publish →
 *  install → run → real stats). The marketplace install state is the runtime gate;
 *  a specialist with no reachable model FAILS honestly instead of faking output. */

import { test, expect, beforeEach, afterAll } from "bun:test";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { db } from "@/lib/db";
import { TemplateAgent, resolveExecutableAgent, type TemplateRow } from "@/lib/genesis/agent-runtime/agents/template-agent";
import { publishPlugin, installPlugin, deprecatePlugin, refreshStats } from "@/lib/genesis/agent-runtime/plugins";
import { seedRegistry } from "@/lib/genesis/agent-runtime/model-registry";

const KEY = "TPLTEST_AUDIT_SPECIALIST";

const KEYS = ["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "OLLAMA_HOST", "ZAI_API_KEY", "PREMIUM_MODE"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];

class SeamedTemplateAgent extends TemplateAgent {
  constructor(t: TemplateRow, seam: "ok" | "throw" = "ok") {
    super(t);
    this.llmInvokeSeam = seam === "ok"
      ? async () => ({ text: "## Findings\n- real seam analysis\n\n## Recommendations\n- act on it", promptTokens: 20, completionTokens: 30 })
      : async () => { throw new Error("HTTP_400 seam refuses every hop"); };
  }
}

async function makeTemplate() {
  return db.agentTemplate.create({ data: { key: KEY, name: "TPLTEST audit specialist", description: "test specialist", systemPrompt: "You audit growth claims for honesty.", toolAllowlist: JSON.stringify(["memory"]), defaultContext: JSON.stringify({ scope: "audit" }), isBuiltin: false } });
}

async function wipe() {
  await db.plugin.deleteMany({ where: { refKey: { startsWith: "TPLTEST" } } });
  await db.agentTemplate.deleteMany({ where: { key: { startsWith: "TPLTEST" } } });
  await db.agentExecution.deleteMany({ where: { agent: { startsWith: "TPLTEST" } } });
  await db.llmUsage.deleteMany({ where: { agent: { startsWith: "TPLTEST" } } });
  await db.activityLog.deleteMany({ where: { agent: { startsWith: "TPLTEST" } } });
  await db.memoryEntry.deleteMany({ where: { source: { startsWith: "TPLTEST" } } });
  await db.artifact.deleteMany({ where: { metadata: { contains: "TPLTEST" } } });
}

beforeEach(async () => {
  await wipe();
  await seedRegistry();
  for (const k of KEYS) delete process.env[k];
  process.env.OPENROUTER_API_KEY = "sk-test"; // a chain must resolve; the seam intercepts
});
afterAll(async () => {
  await wipe();
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  await fs.rm(path.resolve(process.cwd(), ".genesis-workspace", KEY.toLowerCase()), { recursive: true, force: true }).catch(() => {});
});

test("builtins resolve without any marketplace gate (they ARE the OS)", async () => {
  const r = await resolveExecutableAgent("VENTURE");
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.kind).toBe("BUILTIN");
});

test("unknown agent → 404; unlisted template → publish first; LISTED → install first", async () => {
  const missing = await resolveExecutableAgent("TPLTEST_NOPE");
  expect(missing.ok).toBe(false);
  if (!missing.ok) expect(missing.status).toBe(404);

  await makeTemplate(); // template exists but is NOT on the marketplace
  const unlisted = await resolveExecutableAgent(KEY);
  expect(unlisted.ok).toBe(false);
  if (!unlisted.ok) { expect(unlisted.status).toBe(409); expect(unlisted.error).toContain("publish"); }

  await publishPlugin({ kind: "AGENT", refKey: KEY, source: "USER" }); // LISTED, not installed
  const listed = await resolveExecutableAgent(KEY);
  expect(listed.ok).toBe(false);
  if (!listed.ok) { expect(listed.status).toBe(409); expect(listed.error).toContain("install"); }
});

test("DEPRECATED plugin refuses to run (withdrawn specialists stay withdrawn)", async () => {
  await makeTemplate();
  const pub = await publishPlugin({ kind: "AGENT", refKey: KEY, source: "USER" }) as { pluginId: string };
  await installPlugin(pub.pluginId);
  await deprecatePlugin(pub.pluginId, "superseded");
  const r = await resolveExecutableAgent(KEY);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.status).toBe(410);
});

test("INSTALLED template resolves and EXECUTES: real execution row + artifact + marketplace stats", async () => {
  const t = await makeTemplate();
  const pub = await publishPlugin({ kind: "AGENT", refKey: KEY, source: "USER" }) as { pluginId: string };
  await installPlugin(pub.pluginId);

  const resolved = await resolveExecutableAgent(KEY);
  expect(resolved.ok).toBe(true);
  if (resolved.ok) expect(resolved.kind).toBe("TEMPLATE");

  const r = await new SeamedTemplateAgent(t).execute({ goal: "audit the Q3 growth claims" });
  expect(r.status).toBe("SUCCESS");
  expect(r.artifacts.length).toBe(1);
  expect(r.artifacts[0].path.endsWith("SPECIALIST_REPORT.md")).toBe(true);
  expect((r.output.report as string)).toContain("real seam analysis");
  expect(r.output.mode).toBe("LLM"); // labeled: this was a real model round-trip (seamed here)

  const exec = await db.agentExecution.findUnique({ where: { executionId: r.executionId } });
  expect(exec!.agent).toBe(KEY); // lands under the template key…
  await refreshStats(pub.pluginId); // …which is exactly what the marketplace reads
  const p = await db.plugin.findUnique({ where: { pluginId: pub.pluginId } });
  expect(p!.invocations).toBe(1);
  expect(p!.successes).toBe(1);
  expect(p!.performanceScore).toBe(100);
});

test("no reachable model → honest FAILED, never fake specialist output", async () => {
  const t = await makeTemplate();
  const r = await new SeamedTemplateAgent(t, "throw").execute({ goal: "audit something" });
  expect(r.status).toBe("FAILED");
  expect(r.error).toContain("refusing to fake");
  expect(r.artifacts.length).toBe(0); // no report was fabricated
});

test("defaultContext merges under the caller's context", async () => {
  const t = await makeTemplate();
  let seenUser = "";
  class Probe extends TemplateAgent {
    constructor() { super(t); this.llmInvokeSeam = async (_p: unknown, opts: { user?: unknown }) => { seenUser = String(opts.user ?? ""); return { text: "ok", promptTokens: 5, completionTokens: 5 }; }; }
  }
  await new Probe().execute({ goal: "g", context: { scope: "override", extra: 1 } });
  expect(seenUser).toContain('"scope": "override"'); // caller wins
  expect(seenUser).toContain('"extra": 1'); // template default context merged in
});
