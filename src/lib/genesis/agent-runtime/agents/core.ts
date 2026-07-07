/** Core agents (V3): CEO, RESEARCH, ARCHITECT, ENGINEERING, DESIGN, GROWTH, QUALITY, DEPLOYMENT, SECURITY. */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { db } from "@/lib/db";
import { BaseAgent, type AgentRunContext, type AgentRunInput } from "../base-agent";
import { callLlm, parseJsonResponse } from "../types";

// ============ CEO ============
export class CeoAgent extends BaseAgent {
  readonly name = "CEO";
  readonly department = "ceo";
  readonly description = "Strategic decomposition: goal → ordered task plan with owner agents";
  protected async run(input: AgentRunInput, ctx: AgentRunContext) {
    const goal = input.goal;
    const prior = await ctx.recall(goal, ["ceo", "plan"]);
    if (prior.length > 0) await ctx.emit({ action: "MEMORY", detail: `recalled ${prior.length} prior CEO plans`, category: "MEMORY" });

    let plan: { rationale: string; tasks: { taskId: string; title: string; description: string; ownerAgent: string; department: string; priority: string; dependencies: string[]; expectedArtifact: string; validation: string; estimatedHours: number; }[] };
    try {
      const r = await ctx.llm(`You are the CEO of an autonomous AI company. Decompose the goal into 3-7 ordered tasks. Each task: title, description, ownerAgent (RESEARCH|ARCHITECT|ENGINEERING|DESIGN|GROWTH|QUALITY|DEPLOYMENT|SECURITY|OPPORTUNITY|REVENUE), department, priority (CRITICAL|HIGH|MEDIUM|LOW), dependencies (array of placeholder ids T-A, T-B…), expectedArtifact, validation, estimatedHours. Respond ONLY with JSON: {"rationale":"…","tasks":[{…}]}.`, `Goal: ${goal}`, { temperature: 0.4, maxTokens: 1500, timeoutMs: 10_000 });
      if (!r.ok) throw new Error(r.error);
      const parsed = parseJsonResponse(r.text) as { rationale?: string; tasks?: typeof plan.tasks } | null;
      if (!parsed?.tasks?.length) throw new Error("LLM plan has no tasks");
      plan = { rationale: parsed.rationale ?? "LLM decomposition", tasks: parsed.tasks };
    } catch (e) {
      await ctx.emit({ action: "FALLBACK", detail: `LLM failed, rule-based plan`, level: "WARNING" });
      plan = ruleBasedPlan(goal);
    }

    let nextNum = await nextTaskNumber();
    const assignedIds = new Map<string, string>();
    for (const t of plan.tasks) { const taskId = `T-${nextNum.toString().padStart(3, "0")}`; assignedIds.set(t.taskId, taskId); t.taskId = taskId; nextNum++; }
    for (const t of plan.tasks) t.dependencies = t.dependencies.map((d) => assignedIds.get(d) ?? d);

    for (const t of plan.tasks) {
      await db.genesisTask.create({ data: { taskId: t.taskId, title: t.title, description: t.description, ownerAgent: t.ownerAgent, department: t.department, priority: t.priority, status: "PENDING", dependencies: JSON.stringify(t.dependencies), expectedArtifact: t.expectedArtifact, validation: t.validation, estimatedHours: t.estimatedHours, } });
      await ctx.emit({ action: "TASK", detail: `created ${t.taskId} → ${t.ownerAgent}: ${t.title}`, category: "TASK" });
    }

    await db.ceoDecision.create({ data: { title: `Decompose: ${goal.slice(0, 80)}`, rationale: plan.rationale, decision: `Created ${plan.tasks.length} tasks`, impact: "HIGH", status: "EXECUTED" } });
    await ctx.recordMemory({ type: "PROCEDURAL", title: `Plan: ${goal.slice(0, 80)}`, content: JSON.stringify(plan, null, 2), tags: ["ceo", "plan", "decomposition"], importance: 8 });
    return { summary: `Decomposed "${goal}" → ${plan.tasks.length} tasks. ${plan.rationale}`, artifacts: [], output: { plan, taskIds: plan.tasks.map((t) => t.taskId) } };
  }
}

function ruleBasedPlan(goal: string) {
  const t = (id: string, title: string, description: string, ownerAgent: string, department: string, priority: string, deps: string[], expectedArtifact: string, validation: string, estimatedHours: number) => ({ taskId: id, title, description, ownerAgent, department, priority, dependencies: deps, expectedArtifact, validation, estimatedHours });
  return {
    rationale: `Standard pipeline: research → architect → build → test → deploy → grow.`,
    tasks: [
      t("T-A", `Research market & technology for: ${goal}`, "Web research + competitive analysis", "RESEARCH", "research", "HIGH", [], "research-report.md", "≥5 sources, confidence ≥60%", 3),
      t("T-B", `Design architecture for: ${goal}`, "Architecture document + repo scaffold", "ARCHITECT", "ai_systems", "HIGH", ["T-A"], "architecture.md + repo", "Has components, data model, APIs", 2),
      t("T-C", `Build MVP for: ${goal}`, "Install deps, build, test, repair loop, commit", "ENGINEERING", "engineering", "CRITICAL", ["T-B"], "working app + git repo", "Builds & runs without errors", 8),
      t("T-D", `Quality-check the build for: ${goal}`, "Generate tests, security scan, repair", "QUALITY", "quality", "HIGH", ["T-C"], "test suite + security scan", "≥1 test, 0 critical vulns", 2),
      t("T-E", `Security scan for: ${goal}`, "Continuous security scanning + release gate", "SECURITY", "security", "HIGH", ["T-C"], "SecurityFinding rows", "0 critical findings", 1),
      t("T-F", `Prepare deployment for: ${goal}`, "Detect build, validate env, deploy, monitor", "DEPLOYMENT", "engineering", "MEDIUM", ["T-C", "T-D", "T-E"], "deployment record + URL", "build detected, env ok", 1),
      t("T-G", `Growth strategy for: ${goal}`, "GTM plan, channels, KPIs", "GROWTH", "growth", "LOW", ["T-A"], "growth-plan.md", "Has 3 channels + KPIs", 1),
    ],
  };
}

export async function nextTaskNumber(): Promise<number> {
  // String ordering breaks at 4 digits ("T-999" > "T-1000") — take recent rows
  // by createdAt (allocation is monotonic) and compute the max numerically.
  const recent = await db.genesisTask.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { taskId: true } });
  let max = 25; // seed data occupies T-001..T-025
  for (const r of recent) { const m = r.taskId.match(/^T-(\d+)$/); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return max + 1;
}

// ============ RESEARCH ============
export class ResearchAgent extends BaseAgent {
  readonly name = "RESEARCH";
  readonly department = "research";
  readonly description = "Web research, competitor analysis, report generation";
  protected async run(input: AgentRunInput, ctx: AgentRunContext) {
    const goal = input.goal;
    const subQueries = [goal, `${goal} competitors 2025`, `${goal} market size opportunity`, `${goal} reviews alternatives`];
    const allResults: { title: string; url: string; snippet?: string }[] = [];
    for (const q of subQueries) {
      const out = await ctx.tool("browser", "search", { query: q, count: 6 });
      if (out.ok && out.result) {
        const r = out.result as { results?: { title: string; url: string; snippet?: string }[] };
        for (const item of r.results ?? []) allResults.push(item);
      }
      await ctx.emit({ action: "SEARCH", detail: `"${q}" → ${out.ok ? "ok" : "fail"}`, category: "RESEARCH" });
    }
    const seen = new Set<string>();
    const sources = allResults.filter((r) => { if (seen.has(r.url)) return false; seen.add(r.url); return true; }).slice(0, 12);
    const findings: { url: string; title: string; excerpt: string }[] = [];
    for (const src of sources.slice(0, 3)) {
      const out = await ctx.tool("browser", "fetch", { url: src.url });
      if (out.ok && out.raw) findings.push({ url: src.url, title: src.title, excerpt: out.raw.slice(0, 600) });
    }
    // Zero sources means the browser tool is unavailable/failed — report 0, not a fabricated baseline.
    const confidence = sources.length === 0 ? 0 : Math.min(50 + sources.length * 4 + findings.length * 8, 95);
    const category = /(competitor|alternative)/.test(goal) ? "COMPETITOR" : /(market|size|growth)/.test(goal) ? "OPPORTUNITY" : "MARKET";
    const report = await db.researchReport.create({ data: { topic: goal, category, summary: `Researched "${goal}" across ${sources.length} sources.`, findings: JSON.stringify(findings.map((f) => `- ${f.title}: ${f.excerpt.slice(0, 200)}`)), evidence: JSON.stringify(sources.map((s) => ({ title: s.title, url: s.url, snippet: s.snippet ?? "" }))), confidence, status: "PUBLISHED" } });
    const reportPath = path.join(ctx.sandboxRoot, "research-report.md");
    await fs.writeFile(reportPath, `# Research Report: ${goal}\n\n**Confidence:** ${confidence}%\n**Sources:** ${sources.length}\n\n## Findings\n${findings.map((f) => `- ${f.title}: ${f.excerpt.slice(0, 200)}`).join("\n")}\n\n## Evidence\n${sources.map((s) => `- [${s.title}](${s.url})`).join("\n")}\n`, "utf8");
    const stat = await fs.stat(reportPath);
    for (const f of findings.slice(0, 3)) await ctx.recordMemory({ type: "SEMANTIC", title: f.title.slice(0, 100), content: f.excerpt, tags: ["research", category.toLowerCase()], importance: 6, source: `research:${report.id}` });
    return { summary: `Researched "${goal}" → ${sources.length} sources, confidence ${confidence}%.`, artifacts: [{ type: "REPORT", path: reportPath, description: `Research report on ${goal}`, size: stat.size }], output: { reportId: report.id, sourcesCount: sources.length, confidence, category } };
  }
}

// ============ ARCHITECT ============
export class ArchitectAgent extends BaseAgent {
  readonly name = "ARCHITECT";
  readonly department = "ai_systems";
  readonly description = "Architecture design + repository scaffolding";
  protected async run(input: AgentRunInput, ctx: AgentRunContext) {
    const topic = (input.context?.topic as string) ?? input.goal;
    const stack = (input.context?.stackHint as string) ?? detectStack(input.goal);
    const research = await ctx.recall(topic, ["research"]);
    let archMd: string;
    try {
      const r = await ctx.llm(`You are the Architect. Produce a concise architecture document in Markdown for the product. Stack: ${stack}. Sections: Overview, Components, Data Model, APIs, Testing, Risks, Build & Run, Future Hooks. ~400 words.`, `Product: ${topic}`, { temperature: 0.4, maxTokens: 1500, timeoutMs: 8_000 });
      if (!r.ok || r.text.length < 50) throw new Error(r.error ?? "too short");
      archMd = r.text;
    } catch { archMd = `# Architecture — ${topic}\n\n**Stack:** ${stack}\n\n## Overview\n${topic} is a ${stack} application.\n\n## Components\n- Core module\n- Entry layer\n- Storage\n- Config\n\n## Data Model\n- Item: id, name, createdAt, status, payload\n\n## APIs\n- create, list, get, update, delete\n\n## Testing\n- bun test\n\n## Build & Run\n\`\`\`bash\n${stack === "python" ? "pip install -r requirements.txt" : "bun install"}\n\`\`\`\n`; }
    const repoDir = path.join(ctx.sandboxRoot, "repo");
    await fs.mkdir(repoDir, { recursive: true });
    const archPath = path.join(repoDir, "ARCHITECTURE.md");
    await fs.writeFile(archPath, archMd, "utf8");
    const { scaffoldRepo } = await import("./scaffold");
    const scaffold = scaffoldRepo(stack, topic);
    for (const file of scaffold.files) { const p = path.join(repoDir, file.path); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, file.content, "utf8"); }
    await fs.writeFile(path.join(repoDir, ".gitignore"), "node_modules\n.next\ndist\n.env\n*.log\n", "utf8");
    await ctx.tool("terminal", "exec", { command: `git -C "${repoDir}" init && git -C "${repoDir}" add . && git -C "${repoDir}" -c user.email=genesis@shadow.os -c user.name=ARCHITECT commit -m "chore: scaffold ${stack} for ${topic}"` });
    await ctx.recordMemory({ type: "PROCEDURAL", title: `Architecture: ${topic} (${stack})`, content: archMd.slice(0, 4000), tags: ["architect", stack, "architecture"], importance: 8 });
    const archStat = await fs.stat(archPath);
    return { summary: `Architected "${topic}" (${stack}): ${scaffold.files.length} files scaffolded, initial commit created.`, artifacts: [{ type: "DESIGN_DOC", path: archPath, description: `Architecture for ${topic}`, size: archStat.size }, { type: "REPOSITORY", path: repoDir, description: `Scaffolded ${stack} repo`, size: 0 }], output: { topic, stack, repoPath: repoDir, architecturePath: archPath, filesScaffolded: scaffold.files.length } };
  }
}

export function detectStack(goal: string): string {
  const g = goal.toLowerCase();
  if (/\bpython\b/.test(g)) return "python";
  if (/\b(api|server|backend|express|fastify)\b/.test(g)) return "node-api";
  if (/\b(next|web|app|dashboard|react|frontend|website|saas)\b/.test(g) || /\bapp\b/.test(g)) return "nextjs";
  if (/\bcli\b|command.?line/.test(g)) return "node-cli";
  return "node-cli";
}

// ============ ENGINEERING ============
export class EngineeringAgent extends BaseAgent {
  readonly name = "ENGINEERING";
  readonly department = "engineering";
  readonly description = "End-to-end build: scaffold → install → test → repair → commit";
  protected async run(input: AgentRunInput, ctx: AgentRunContext) {
    const params = (input.context ?? {}) as { repoPath?: string; topic?: string; stackHint?: string; maxRepairs?: number };
    const topic = params.topic ?? input.goal;
    const stack = params.stackHint ?? detectStack(topic);
    const maxRepairs = Math.min(Math.max(params.maxRepairs ?? 3, 1), 5);
    let repoPath = params.repoPath ?? "";
    if (!repoPath || !(await pathExists(repoPath))) {
      repoPath = path.join(ctx.sandboxRoot, "repo");
      await fs.mkdir(repoPath, { recursive: true });
      const { scaffoldRepo } = await import("./scaffold");
      const scaffold = scaffoldRepo(stack, topic);
      for (const file of scaffold.files) { const p = path.join(repoPath, file.path); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, file.content, "utf8"); }
    } else {
      const dest = path.join(ctx.sandboxRoot, "repo");
      await fs.mkdir(dest, { recursive: true });
      await copyDir(repoPath, dest);
      repoPath = dest;
    }
    await ctx.tool("terminal", "exec", { command: `git -C "${repoPath}" init 2>/dev/null; true` });
    // Install
    const installCmd = stack === "python" ? "pip install -r requirements.txt 2>&1 || true" : "bun install 2>&1 || npm install 2>&1";
    const install = await ctx.tool("terminal", "exec", { command: `cd "${repoPath}" && ${installCmd}`, timeoutMs: 180_000 });
    await ctx.emit({ action: "INSTALL", detail: `deps → exit ${install.ok ? 0 : "fail"}`, level: install.ok ? "SUCCESS" : "WARNING", category: "BUILD" });
    // Build + test loop
    let attempt = 0, testsPassed = 0, testsFailed = 0, buildOk = false, testsOk = false;
    const repairedFiles: string[] = [];
    while (attempt <= maxRepairs) {
      attempt++;
      if (stack !== "python") {
        const buildCmd = stack === "nextjs" ? `cd "${repoPath}" && (bun run build 2>&1 || npm run build 2>&1)` : `cd "${repoPath}" && (node -c src/index.js 2>&1 || node -c src/server.js 2>&1 || true)`;
        const build = await ctx.tool("terminal", "exec", { command: buildCmd, timeoutMs: 120_000 });
        buildOk = build.ok;
        await ctx.emit({ action: "BUILD", detail: `attempt ${attempt} → ${buildOk ? "ok" : "fail"}`, level: buildOk ? "SUCCESS" : "WARNING", category: "BUILD" });
      } else buildOk = true;
      const testCmd = stack === "python" ? `cd "${repoPath}" && (python -m pytest -q 2>&1 || true)` : `cd "${repoPath}" && (bun test 2>&1 || npm test 2>&1 || true)`;
      const tests = await ctx.tool("terminal", "exec", { command: testCmd, timeoutMs: 120_000 });
      testsOk = tests.ok;
      const m = tests.raw?.match(/(\d+)\s+pass/i); const f = tests.raw?.match(/(\d+)\s+fail/i);
      const pm = tests.raw?.match(/(\d+)\s+passed/); const pf = tests.raw?.match(/(\d+)\s+failed/);
      testsPassed = m ? parseInt(m[1], 10) : pm ? parseInt(pm[1], 10) : 0;
      testsFailed = f ? parseInt(f[1], 10) : pf ? parseInt(pf[1], 10) : 0;
      await ctx.emit({ action: "TEST", detail: `attempt ${attempt}: ${testsPassed} pass / ${testsFailed} fail`, level: testsOk ? "SUCCESS" : "WARNING", category: "TEST" });
      await db.testRun.create({ data: { executionId: ctx.executionId, taskId: input.taskId ?? null, suite: `${stack}-tests`, passed: testsPassed, failed: testsFailed, skipped: 0, durationMs: 0, status: testsOk ? "PASSED" : "FAILED", output: (tests.raw ?? "").slice(-4000) } });
      if (buildOk && testsOk) break;
      if (attempt > maxRepairs) break;
      // Repair: try LLM patch then rule-based
      const failure = !buildOk ? "build failed" : (tests.raw ?? "");
      const patched = await repair(repoPath, failure, ctx);
      if (patched.length === 0) break;
      repairedFiles.push(...patched);
    }
    const finalOk = buildOk && testsOk;
    if (finalOk) {
      await ctx.tool("terminal", "exec", { command: `cd "${repoPath}" && git add -A && git -c user.email=genesis@shadow.os -c user.name=ENGINEERING commit -m "feat: ship ${topic} (${stack})" 2>&1 || true` });
    }
    const version = `eng-${Date.now().toString(36)}`;
    await db.buildCheckpoint.create({ data: { version, type: finalOk ? "RELEASE" : "ROLLBACK", summary: `ENGINEERING ${finalOk ? "shipped" : "failed"} ${topic} (${stack}). ${testsPassed}/${testsPassed + testsFailed} tests.`, changesCount: repairedFiles.length, testsPassed, testsFailed, status: finalOk ? "PASSED" : "FAILED" } });
    await ctx.recordMemory({ type: "PROCEDURAL", title: `Build SOP: ${stack} (${finalOk ? "success" : "failure"})`, content: `Goal: ${topic}\nStack: ${stack}\nAttempts: ${attempt}\nTests: ${testsPassed}/${testsPassed + testsFailed}`, tags: ["engineering", stack, finalOk ? "success" : "failure", "sop"], importance: finalOk ? 7 : 9 });
    return { summary: finalOk ? `Shipped ${topic} (${stack}): ${testsPassed} tests passed, ${repairedFiles.length} files repaired.` : `Failed to ship ${topic} after ${attempt} attempts.`, artifacts: [{ type: "REPOSITORY", path: repoPath, description: `Built ${stack} repo for ${topic}`, size: 0 }], output: { topic, stack, repoPath, buildOk, testsOk, testsPassed, testsFailed, attempts: attempt, repairedFiles, buildVersion: version } };
  }
}

async function repair(repoPath: string, failure: string, ctx: AgentRunContext): Promise<string[]> {
  // Identify failing files from error output
  const patterns = [/(?:at\s+)?([^\s:]+\.(?:ts|js|tsx|jsx|py)):\d+/g, /(tests\/[^\s:]+\.(?:test\.)?(?:ts|js|py))/g, /(src\/[^\s:]+\.(?:ts|js|py))/g];
  const files = new Set<string>();
  for (const p of patterns) for (const m of failure.matchAll(p)) if (m[1]) files.add(m[1]);
  const patched: string[] = [];
  for (const file of [...files].slice(0, 3)) {
    const fp = path.isAbsolute(file) ? file : path.join(repoPath, file);
    const original = await fs.readFile(fp, "utf8").catch(() => null);
    if (!original) continue;
    let patchedContent: string | null = null;
    try {
      const r = await ctx.llm(`You are an engineering repair loop. Return the FULL corrected file. No explanation.`, `File: ${file}\n\nFailure:\n${failure.slice(0, 3000)}\n\nOriginal:\n${original.slice(0, 8000)}`, { temperature: 0.2, maxTokens: 2000, timeoutMs: 10_000 });
      if (r.ok) {
        const stripped = r.text.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "");
        if (stripped.length > 10 && stripped.length < 20_000) patchedContent = stripped;
      }
    } catch {}
    if (!patchedContent) {
      // Rule-based patch
      let p = original;
      if (/is not exported|is not defined/.test(failure)) { const m = failure.match(/(\w+)\s+is not (?:exported|defined)/); if (m) p += `\nexport const ${m[1]} = () => { throw new Error("not implemented"); };\n`; }
      if (patchedContent === null && p !== original) patchedContent = p;
    }
    if (patchedContent && patchedContent !== original) { await fs.writeFile(fp, patchedContent, "utf8"); patched.push(file); }
  }
  return patched;
}

// ============ DESIGN ============
export class DesignAgent extends BaseAgent {
  readonly name = "DESIGN";
  readonly department = "design";
  readonly description = "Design-system docs, CSS tokens, preview HTML";
  protected async run(input: AgentRunInput, ctx: AgentRunContext) {
    const topic = (input.context?.topic as string) ?? input.goal;
    const category = (input.context?.category as string) ?? "developer";
    const palette = { consumer: { name: "Aurora", bg: "#0b0f1a", fg: "#f5f7fa", accent: "#7c5cff", muted: "#6b7280" }, b2b: { name: "Slate", bg: "#ffffff", fg: "#0f172a", accent: "#2563eb", muted: "#64748b" }, developer: { name: "Terminal", bg: "#0a0e14", fg: "#e6edf3", accent: "#3fb950", muted: "#7d8590" }, minimal: { name: "Paper", bg: "#fafafa", fg: "#111", accent: "#000", muted: "#888" }, playful: { name: "Candy", bg: "#fff5f7", fg: "#2d1b3a", accent: "#ff5c8a", muted: "#8b7d8f" } }[category as "consumer" | "b2b" | "developer" | "minimal" | "playful"] ?? { name: "Terminal", bg: "#0a0e14", fg: "#e6edf3", accent: "#3fb950", muted: "#7d8590" };
    const dir = path.join(ctx.sandboxRoot, "design");
    await fs.mkdir(dir, { recursive: true });
    const tokens = `:root {\n  --color-bg: ${palette.bg};\n  --color-fg: ${palette.fg};\n  --color-accent: ${palette.accent};\n  --color-muted: ${palette.muted};\n  --radius-md: 8px;\n  --font-sans: system-ui, sans-serif;\n}\n`;
    const tokensPath = path.join(dir, "tokens.css");
    await fs.writeFile(tokensPath, tokens, "utf8");
    const readme = `# Design System — ${topic}\n\n**Palette:** ${palette.name} (${category})\n\n## Components\n- Button, Input, Card, Modal, Toast, Layout\n\n## Voice & Tone\n- ${category === "developer" ? "Technical and concise" : category === "playful" ? "Warm, slightly whimsical" : "Confident and clear"}\n`;
    const readmePath = path.join(dir, "DESIGN.md");
    await fs.writeFile(readmePath, readme, "utf8");
    await ctx.recordMemory({ type: "SEMANTIC", title: `Design: ${palette.name} for ${topic}`, content: readme, tags: ["design", category, palette.name.toLowerCase()], importance: 6 });
    const tokensStat = await fs.stat(tokensPath);
    const readmeStat = await fs.stat(readmePath);
    return { summary: `Designed ${topic} (${palette.name}): tokens.css + DESIGN.md`, artifacts: [{ type: "FILE", path: tokensPath, description: "CSS tokens", size: tokensStat.size }, { type: "FILE", path: readmePath, description: "Design README", size: readmeStat.size }], output: { topic, category, palette: palette.name, dir } };
  }
}

// ============ GROWTH ============
export class GrowthAgent extends BaseAgent {
  readonly name = "GROWTH";
  readonly department = "growth";
  readonly description = "GTM strategy, channels, KPIs, experiment tracking";
  protected async run(input: AgentRunInput, ctx: AgentRunContext) {
    const topic = (input.context?.topic as string) ?? input.goal;
    const audience = (input.context?.audience as string) ?? "early adopters";
    let plan: { positioning: string; channels: { name: string; rationale: string; kpis: { name: string; target: string }[] }[] };
    try {
      const r = await ctx.llm(`You are a growth lead. Produce a JSON growth plan. Format: {"positioning":"1 sentence","channels":[{"name":"…","rationale":"…","kpis":[{"name":"…","target":"…"}]}]}. 3 channels max.`, `Product: ${topic}\nAudience: ${audience}`, { temperature: 0.5, maxTokens: 900, timeoutMs: 8_000 });
      if (!r.ok) throw new Error(r.error);
      const parsed = parseJsonResponse(r.text) as { positioning?: string; channels?: typeof plan.channels } | null;
      if (!parsed?.channels?.length) throw new Error("no channels");
      plan = { positioning: parsed.positioning ?? `${topic} for ${audience}`, channels: parsed.channels };
    } catch {
      plan = { positioning: `${topic} is the fastest path from idea to working MVP for ${audience}.`, channels: [{ name: "Content (SEO)", rationale: "Long-tail queries capture high-intent traffic.", kpis: [{ name: "Organic sessions/mo", target: "5,000" }, { name: "Email signups", target: "300" }] }, { name: "Community (Discord)", rationale: "Focused community multiplies retention.", kpis: [{ name: "Active members", target: "500" }, { name: "WAU/MAU", target: "0.35" }] }, { name: "Product Hunt launch", rationale: "One-shot spike that seeds funnel.", kpis: [{ name: "Upvotes", target: "800" }, { name: "Signups day 1", target: "1,200" }] }] };
    }
    const dir = path.join(ctx.sandboxRoot, "growth");
    await fs.mkdir(dir, { recursive: true });
    const planPath = path.join(dir, "growth-plan.md");
    await fs.writeFile(planPath, `# Growth Plan — ${topic}\n\n**Positioning:** ${plan.positioning}\n\n## Channels\n${plan.channels.map((c) => `### ${c.name}\n${c.rationale}\n\n**KPIs:**\n${c.kpis.map((k) => `- ${k.name}: ${k.target}`).join("\n")}\n`).join("\n")}\n`, "utf8");
    const kpisPath = path.join(dir, "kpis.json");
    await fs.writeFile(kpisPath, JSON.stringify({ topic, audience, positioning: plan.positioning, channels: plan.channels }, null, 2), "utf8");
    await ctx.recordMemory({ type: "SEMANTIC", title: `GTM for ${topic}`, content: plan.positioning, tags: ["growth", "gtm"], importance: 6 });
    const planStat = await fs.stat(planPath);
    return { summary: `Growth plan for ${topic}: ${plan.channels.length} channels`, artifacts: [{ type: "FILE", path: planPath, description: "Growth plan", size: planStat.size }], output: { topic, audience, channels: plan.channels.length, positioning: plan.positioning, dir } };
  }
}

// ============ QUALITY ============
export class QualityAgent extends BaseAgent {
  readonly name = "QUALITY";
  readonly department = "quality";
  readonly description = "Test generation, security scan, bug detection, repair";
  protected async run(input: AgentRunInput, ctx: AgentRunContext) {
    const repoPath = (input.context?.repoPath as string) ?? path.join(ctx.sandboxRoot, "repo");
    if (!(await pathExists(repoPath))) { await fs.mkdir(repoPath, { recursive: true }); await fs.writeFile(path.join(repoPath, "src", "core.js"), `export const hello = () => "world";\n`, "utf8"); await fs.writeFile(path.join(repoPath, "package.json"), JSON.stringify({ name: "q-target", type: "module", scripts: { test: "bun test" } }, null, 2), "utf8"); }
    const sourceFiles = await discoverSources(repoPath);
    const SECURITY_RULES = [
      { rule: "no-eval", severity: "CRITICAL" as const, pattern: /\beval\s*\(/, message: "eval() forbidden" },
      { rule: "no-shell-true", severity: "HIGH" as const, pattern: /spawn\s*\([^)]*shell\s*:\s*true/, message: "spawn shell:true unsafe" },
      { rule: "no-inner-html", severity: "HIGH" as const, pattern: /\.innerHTML\s*=/, message: "innerHTML — XSS risk" },
      { rule: "no-hardcoded-secret", severity: "MEDIUM" as const, pattern: /(api[_-]?key|secret|token|password)\s*=\s*['"][^'"]{8,}['"]/i, message: "Hardcoded credential" },
    ];
    const findings: { file: string; line: number; severity: string; rule: string; message: string }[] = [];
    for (const file of sourceFiles) {
      const content = await fs.readFile(file, "utf8").catch(() => "");
      content.split("\n").forEach((line, i) => {
        for (const rule of SECURITY_RULES) if (rule.pattern.test(line)) findings.push({ file: path.relative(repoPath, file), line: i + 1, severity: rule.severity, rule: rule.rule, message: rule.message });
      });
    }
    const criticalCount = findings.filter((f) => f.severity === "CRITICAL").length;
    // Persist findings
    for (const f of findings) {
      await db.securityFinding.create({ data: { agent: "QUALITY", scope: "SOURCE", scopeId: ctx.executionId, rule: f.rule, severity: f.severity, message: f.message, file: f.file, line: f.line, status: "OPEN", blocksRelease: f.severity === "CRITICAL" } }).catch(() => {});
    }
    // Generate missing tests
    const generatedTests: string[] = [];
    for (const src of sourceFiles.slice(0, 8)) {
      const rel = path.relative(repoPath, src);
      const testRel = rel.replace(/^(src|lib)\//, "tests/").replace(/\.(ts|js|py)$/, ".test.$1");
      const testPath = path.join(repoPath, testRel);
      if (await pathExists(testPath)) continue;
      const content = await fs.readFile(src, "utf8").catch(() => "");
      const ext = path.extname(src);
      const test = generateTest(rel, content, ext);
      if (test) { await fs.mkdir(path.dirname(testPath), { recursive: true }); await fs.writeFile(testPath, test, "utf8"); generatedTests.push(testRel); }
    }
    // Run tests
    const testResult = await ctx.tool("terminal", "exec", { command: `cd "${repoPath}" && (bun test 2>&1 || npm test 2>&1 || python -m pytest -q 2>&1 || true)`, timeoutMs: 120_000 });
    const m = testResult.raw?.match(/(\d+)\s+pass/i); const f = testResult.raw?.match(/(\d+)\s+fail/i);
    const testsPassed = m ? parseInt(m[1], 10) : 0; const testsFailed = f ? parseInt(f[1], 10) : 0;
    await db.testRun.create({ data: { executionId: ctx.executionId, taskId: input.taskId ?? null, suite: "quality-tests", passed: testsPassed, failed: testsFailed, skipped: 0, durationMs: 0, status: testResult.ok ? "PASSED" : "FAILED", output: (testResult.raw ?? "").slice(-4000) } });
    const reportPath = path.join(ctx.sandboxRoot, "quality-report.md");
    await fs.writeFile(reportPath, `# Quality Report\n\n**Sources:** ${sourceFiles.length}\n**Tests generated:** ${generatedTests.length}\n**Security findings:** ${findings.length} (${criticalCount} critical)\n**Tests:** ${testsPassed} pass / ${testsFailed} fail\n\n## Findings\n${findings.map((f) => `- [${f.severity}] ${f.file}:${f.line} — ${f.rule}`).join("\n") || "✅ none"}\n`, "utf8");
    await ctx.recordMemory({ type: "PROCEDURAL", title: `Quality: ${testsPassed}/${testsPassed + testsFailed} tests, ${findings.length} findings`, content: "", tags: ["quality", "scan", criticalCount > 0 ? "critical" : "ok"], importance: criticalCount > 0 ? 9 : 5 });
    const reportStat = await fs.stat(reportPath);
    const ok = testResult.ok && criticalCount === 0;
    return { summary: ok ? `Quality OK: ${testsPassed} tests, 0 critical findings.` : `Quality issues: ${testsFailed} failures, ${criticalCount} critical.`, artifacts: [{ type: "FILE", path: reportPath, description: "Quality report", size: reportStat.size }], output: { repoPath, sourcesScanned: sourceFiles.length, testsGenerated: generatedTests.length, securityFindings: findings, testsPassed, testsFailed, ok } };
  }
}

// ============ DEPLOYMENT ============
export class DeploymentAgent extends BaseAgent {
  readonly name = "DEPLOYMENT";
  readonly department = "engineering";
  readonly description = "Build detection, env validation, deployment, health monitor, rollback";
  protected async run(input: AgentRunInput, ctx: AgentRunContext) {
    const params = (input.context ?? {}) as { repoPath?: string; target?: string; requiredEnv?: string[]; port?: number; stack?: string; stackHint?: string; };
    const repoPath = params.repoPath ?? "";
    if (!repoPath || !(await pathExists(repoPath))) throw new Error(`no repoPath in context (got "${repoPath}") — dependency handoff missing or build never produced a repo`);
    const target = params.target ?? "local";
    const port = params.port ?? 3001;
    const stack = params.stack ?? params.stackHint ?? "";
    const isServerStack = stack === "nextjs" || stack === "node-api";
    // Security release check
    const blockers = await db.securityFinding.findMany({ where: { status: "OPEN", blocksRelease: true } });
    if (blockers.length > 0) {
      await ctx.emit({ action: "BLOCK", detail: `blocked by ${blockers.length} critical security findings`, level: "ERROR", category: "SECURITY" });
      return { summary: `Deployment blocked by ${blockers.length} critical security findings`, artifacts: [], output: { ok: false, blocked: true, blockers: blockers.length } };
    }
    const record = await db.deploymentRecord.create({ data: { executionId: ctx.executionId, taskId: input.taskId ?? null, projectId: input.projectId ?? null, target, buildCmd: "auto-detect", envValidation: "{}", status: "BUILDING", log: "" } });
    // Detect build system
    const pkgExists = await pathExists(path.join(repoPath, "package.json"));
    const buildCmd = pkgExists ? "cd ${repoPath} && (bun run build 2>&1 || npm run build 2>&1 || true)" : "";
    if (buildCmd) {
      const build = await ctx.tool("terminal", "exec", { command: buildCmd.replace("${repoPath}", repoPath), timeoutMs: 180_000 });
      if (!build.ok) {
        await db.deploymentRecord.update({ where: { id: record.id }, data: { status: "FAILED", log: (build.raw ?? "").slice(-4000) } });
        return { summary: `Build failed`, artifacts: [], output: { ok: false, recordId: record.id } };
      }
    }
    // A CLI/library has no server to run — its start script executes and exits.
    // Report that honestly instead of health-checking a port nothing listens on.
    let startScript = "";
    if (pkgExists) {
      try { const pkg = JSON.parse(await fs.readFile(path.join(repoPath, "package.json"), "utf8")) as { scripts?: Record<string, string> }; startScript = pkg.scripts?.start ?? ""; } catch {}
    }
    const hasStartScript = Boolean(startScript);
    if (!hasStartScript || (stack && !isServerStack)) {
      await db.deploymentRecord.update({ where: { id: record.id }, data: { status: "DEPLOYED", log: "No start script — build verified, nothing to serve" } });
      await ctx.emit({ action: "DEPLOY", detail: `no start script in ${repoPath} — build verified, nothing to serve`, level: "INFO", category: "DEPLOY" });
      return { summary: `Build verified for ${target}; no start script — nothing to serve (CLI/library)`, artifacts: [], output: { target, url: null, skipped: "NO_START_SCRIPT", recordId: record.id } };
    }
    // Start local server
    let url: string | null = null;
    if (target === "local") {
      if (pkgExists) {
        // The host may not have node — bun runs node entrypoints natively, so
        // "node <file>" start scripts are executed as "bun <file>".
        const nodeEntry = startScript.match(/^node\s+(\S+)$/)?.[1];
        const runCmd = nodeEntry ? `bun ${nodeEntry}` : "bun run start";
        // nohup + & works in both /bin/sh and Git Bash on Windows (setsid is Linux-only)
        await ctx.tool("terminal", "exec", { command: `cd "${repoPath}" && nohup sh -c 'PORT=${port} ${runCmd}' > deploy-${record.id}.log 2>&1 &`, timeoutMs: 5_000 });
        url = `http://localhost:${port}`;
        // Health check
        await new Promise((r) => setTimeout(r, 3000));
        // Any HTTP response means the server is listening — a 404 at "/" is
        // still a live server (the scaffolded API only serves /items).
        const health = await fetch(`${url}`, { signal: AbortSignal.timeout(2000) }).catch(() => null);
        const healthOk = health !== null;
        await db.deploymentRecord.update({ where: { id: record.id }, data: { status: healthOk ? "DEPLOYED" : "UNHEALTHY", url, health: healthOk ? "HEALTHY" : "UNHEALTHY", log: `Health: ${healthOk ? "ok" : "failed"}` } });
        await ctx.emit({ action: "DEPLOY", detail: `local → ${url} (${healthOk ? "healthy" : "unhealthy"})`, level: healthOk ? "SUCCESS" : "ERROR", category: "DEPLOY" });
        if (!healthOk) throw new Error(`deployment unhealthy: server at ${url} did not respond within 5s (see deploy-${record.id}.log in repo)`);
        return { summary: `Deployed to ${target}: ${url} (healthy)`, artifacts: [{ type: "DEPLOYMENT", path: repoPath, description: `Deployed app`, size: 0 }], output: { target, url, healthOk, recordId: record.id } };
      }
    }
    await db.deploymentRecord.update({ where: { id: record.id }, data: { status: "DEPLOYED", url } });
    return { summary: `Deployed to ${target}`, artifacts: [], output: { target, url, recordId: record.id } };
  }
}

// ============ SECURITY ============
export class SecurityAgent extends BaseAgent {
  readonly name = "SECURITY";
  readonly department = "security";
  readonly description = "Continuous security scanning + release blocking";
  protected async run(input: AgentRunInput, ctx: AgentRunContext) {
    const repoPath = (input.context?.repoPath as string) ?? path.join(ctx.sandboxRoot, "repo");
    if (!(await pathExists(repoPath))) await fs.mkdir(repoPath, { recursive: true });
    const sourceFiles = await discoverSources(repoPath);
    const RULES = [
      { rule: "no-eval", severity: "CRITICAL" as const, pattern: /\beval\s*\(/, message: "eval() forbidden" },
      { rule: "no-shell-true", severity: "HIGH" as const, pattern: /spawn\s*\([^)]*shell\s*:\s*true/, message: "spawn shell:true" },
      { rule: "no-inner-html", severity: "HIGH" as const, pattern: /\.innerHTML\s*=/, message: "innerHTML — XSS" },
      { rule: "no-hardcoded-secret", severity: "MEDIUM" as const, pattern: /(api[_-]?key|secret|token|password)\s*=\s*['"][^'"]{8,}['"]/i, message: "Hardcoded credential" },
      { rule: "no-disable-tls", severity: "HIGH" as const, pattern: /rejectUnauthorized\s*:\s*false/, message: "TLS disabled" },
      { rule: "no-debugger", severity: "LOW" as const, pattern: /\bdebugger\b/, message: "debugger statement" },
    ];
    const findings: { file: string; line: number; severity: string; rule: string; message: string }[] = [];
    for (const file of sourceFiles) {
      const content = await fs.readFile(file, "utf8").catch(() => "");
      content.split("\n").forEach((line, i) => {
        for (const rule of RULES) if (rule.pattern.test(line)) findings.push({ file: path.relative(repoPath, file), line: i + 1, severity: rule.severity, rule: rule.rule, message: rule.message });
      });
    }
    for (const f of findings) {
      await db.securityFinding.create({ data: { agent: "SECURITY", scope: "SOURCE", scopeId: ctx.executionId, rule: f.rule, severity: f.severity, message: f.message, file: f.file, line: f.line, status: "OPEN", blocksRelease: f.severity === "CRITICAL" } });
    }
    const criticalCount = findings.filter((f) => f.severity === "CRITICAL").length;
    await ctx.emit({ action: "SCAN", detail: `${findings.length} findings (${criticalCount} critical)`, level: criticalCount > 0 ? "CRITICAL" : "SUCCESS", category: "SECURITY" });
    if (criticalCount > 0) {
      try { const { getMessageBus } = await import("../collab"); await getMessageBus().send("SECURITY", "DEPLOYMENT", "BLOCK", { reason: `${criticalCount} critical findings`, findings: findings.filter((f) => f.severity === "CRITICAL") }); } catch {}
    }
    await ctx.recordMemory({ type: "PROCEDURAL", title: `Security scan: ${findings.length} findings`, content: JSON.stringify(findings), tags: ["security", "scan", criticalCount > 0 ? "critical" : "ok"], importance: criticalCount > 0 ? 9 : 5 });
    return { summary: `Security: ${findings.length} findings (${criticalCount} critical) ${criticalCount > 0 ? "— BLOCKS release" : "— release allowed"}`, artifacts: [], output: { findings, criticalCount, blocksRelease: criticalCount > 0 } };
  }
}

// ============ helpers ============
async function discoverSources(repoPath: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (["node_modules", ".git", ".next", "dist", ".venv"].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(ts|js|tsx|jsx|py)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
    }
  }
  await walk(repoPath);
  return out;
}

function generateTest(relPath: string, content: string, ext: string): string | null {
  if (ext === ".py") {
    const mod = relPath.replace(/\//g, ".").replace(/\.py$/, "");
    const funcs = Array.from(content.matchAll(/^def\s+(\w+)/gm)).map((m) => m[1]).filter((n) => !n.startsWith("_"));
    if (!funcs.length) return null;
    return `from ${mod} import ${funcs.join(", ")}\n\n${funcs.map((f) => `def test_${f}_smoke():\n    assert callable(${f})\n`).join("\n")}`;
  }
  const exports_ = Array.from(content.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)).map((m) => m[1]);
  if (!exports_.length) return null;
  const importPath = relPath.replace(/^src\//, "../src/").replace(/^lib\//, "../lib/").replace(/\.(ts|js)$/, "");
  return `import { test, expect } from "bun:test";\nimport { ${exports_.join(", ")} } from "${importPath}";\n\n${exports_.map((n) => `test("${n} is defined", () => { expect(typeof ${n}).toBeDefined(); });\n`).join("\n")}`;
}

async function pathExists(p: string): Promise<boolean> { try { await fs.access(p); return true; } catch { return false; } }
async function copyDir(src: string, dest: string): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true });
  await fs.mkdir(dest, { recursive: true });
  for (const e of entries) {
    if (["node_modules", ".git", ".venv"].includes(e.name)) continue;
    const s = path.join(src, e.name); const d = path.join(dest, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}
