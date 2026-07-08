/** Tool execution layer — sandboxed, logged, permission-checked. */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import vm from "node:vm";
import { resolveShell, normalizeCommand } from "../shell";

export interface ToolContext {
  executionId: string;
  agent: string;
  sandboxRoot: string;
  timeoutMs?: number;
}

export interface ToolOutput {
  ok: boolean;
  result?: unknown;
  summary: string;
  raw?: string;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  operations: string[];
  execute(operation: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput>;
}

const MAX_OUT = 200_000;
const DEFAULT_TIMEOUT = 60_000;

function resolveSafe(root: string, raw: string): string {
  const target = path.resolve(root, raw);
  if (!target.startsWith(path.resolve(root))) throw new Error(`path escapes sandbox: ${raw}`);
  return target;
}

async function sh(cwd: string, cmd: string, timeoutMs = DEFAULT_TIMEOUT) {
  return new Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }>((resolve) => {
    const start = Date.now();
    const shell = resolveShell();
    const child = spawn(shell.file, [...shell.args, normalizeCommand(cmd)], { cwd, env: { ...process.env, CI: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", settled = false;
    const finish = (exitCode: number) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ exitCode, stdout, stderr, durationMs: Date.now() - start }); };
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} setTimeout(() => finish(-1), 2_000); }, timeoutMs);
    child.stdout.on("data", (b: Buffer) => { stdout += b.toString("utf8").slice(0, MAX_OUT); });
    child.stderr.on("data", (b: Buffer) => { stderr += b.toString("utf8").slice(0, MAX_OUT); });
    // Don't rely on "close" alone: a detached grandchild (e.g. a deployed
    // server) can hold the stdio handles forever on Windows, so "close" never
    // fires. "exit" + a short flush grace covers that case.
    child.on("exit", (c) => { setTimeout(() => finish(typeof c === "number" ? c : -1), 500); });
    child.on("close", (c) => { finish(typeof c === "number" ? c : -1); });
    child.on("error", () => finish(-1));
  });
}

export const filesystemTool: Tool = {
  name: "filesystem",
  description: "Sandboxed file ops: read, write, append, list, mkdir, rm, stat, exists",
  operations: ["read", "write", "append", "list", "mkdir", "rm", "stat", "exists"],
  async execute(op, input, ctx) {
    try {
      const root = ctx.sandboxRoot;
      switch (op) {
        case "read": {
          const p = resolveSafe(root, String(input.path));
          const buf = await fs.readFile(p);
          return { ok: true, summary: `read ${path.relative(root, p)} (${buf.length}b)`, result: { path: p, bytes: buf.length }, raw: buf.toString("utf8").slice(0, MAX_OUT) };
        }
        case "write": {
          const p = resolveSafe(root, String(input.path));
          const content = String(input.content ?? "");
          await fs.mkdir(path.dirname(p), { recursive: true });
          await fs.writeFile(p, content, "utf8");
          return { ok: true, summary: `wrote ${path.relative(root, p)} (${content.length}b)`, result: { path: p, bytes: content.length } };
        }
        case "append": {
          const p = resolveSafe(root, String(input.path));
          const content = String(input.content ?? "");
          await fs.mkdir(path.dirname(p), { recursive: true });
          await fs.appendFile(p, content, "utf8");
          return { ok: true, summary: `appended ${content.length}b to ${path.relative(root, p)}`, result: { path: p } };
        }
        case "list": {
          const p = resolveSafe(root, String(input.path ?? "."));
          const entries = await fs.readdir(p, { withFileTypes: true });
          return { ok: true, summary: `listed ${entries.length} entries`, result: { path: p, entries: entries.map((e) => ({ name: e.name, type: e.isDirectory() ? "dir" : "file" })) } };
        }
        case "mkdir": {
          const p = resolveSafe(root, String(input.path));
          await fs.mkdir(p, { recursive: true });
          return { ok: true, summary: `mkdir ${path.relative(root, p)}`, result: { path: p } };
        }
        case "rm": {
          const p = resolveSafe(root, String(input.path));
          await fs.rm(p, { recursive: Boolean(input.recursive), force: false });
          return { ok: true, summary: `rm ${path.relative(root, p)}`, result: { path: p } };
        }
        case "stat": {
          const p = resolveSafe(root, String(input.path));
          const st = await fs.stat(p);
          return { ok: true, summary: `stat ${path.relative(root, p)} (${st.size}b)`, result: { path: p, size: st.size, isFile: st.isFile(), isDir: st.isDirectory(), mtime: st.mtime.toISOString() } };
        }
        case "exists": {
          const p = resolveSafe(root, String(input.path));
          const exists = await fs.access(p).then(() => true).catch(() => false);
          return { ok: true, summary: `exists=${exists}`, result: { path: p, exists } };
        }
        default: return { ok: false, summary: `unknown fs op: ${op}`, error: "UNKNOWN_OP" };
      }
    } catch (e) { return { ok: false, summary: `fs ${op} failed: ${e instanceof Error ? e.message : String(e)}`, error: String(e) }; }
  },
};

export const terminalTool: Tool = {
  name: "terminal",
  description: "Sandboxed shell. Operations: exec, which",
  operations: ["exec", "which"],
  async execute(op, input, ctx) {
    try {
      if (op === "which") {
        const r = await sh(ctx.sandboxRoot, `which ${String(input.command ?? "")}`);
        const found = r.exitCode === 0 && r.stdout.trim().length > 0;
        return { ok: true, summary: `which ${input.command}: ${found ? "found" : "not found"}`, result: { command: input.command, found, path: r.stdout.trim() || null } };
      }
      if (op === "exec") {
        const cmd = String(input.command ?? "");
        if (!cmd) return { ok: false, summary: "exec: missing command", error: "BAD_INPUT" };
        const r = await sh(ctx.sandboxRoot, cmd, Math.min(Number(input.timeoutMs ?? DEFAULT_TIMEOUT), 300_000));
        const ok = r.exitCode === 0;
        return { ok, summary: `exec → exit ${r.exitCode} [${r.durationMs}ms]`, result: { exitCode: r.exitCode, durationMs: r.durationMs }, raw: r.stdout + (r.stderr ? `\n[stderr]\n${r.stderr}` : ""), error: ok ? undefined : `EXIT_${r.exitCode}` };
      }
      return { ok: false, summary: `unknown terminal op: ${op}`, error: "UNKNOWN_OP" };
    } catch (e) { return { ok: false, summary: `terminal ${op} failed: ${e instanceof Error ? e.message : String(e)}`, error: String(e) }; }
  },
};

export const codeTool: Tool = {
  name: "code",
  description: "Sandboxed code execution. Operations: eval, run",
  operations: ["eval", "run"],
  async execute(op, input, ctx) {
    try {
      if (op === "eval") {
        const code = String(input.code ?? "");
        if (!code) return { ok: false, summary: "eval: missing code", error: "BAD_INPUT" };
        const logs: string[] = [];
        const sandbox = {
          console: { log: (...a: unknown[]) => logs.push(a.map(format).join(" ")), error: (...a: unknown[]) => logs.push("[err] " + a.map(format).join(" ")) },
          Math, JSON, Date, Array, Object, String, Number, Boolean, RegExp, Map, Set, Promise, BigInt, Symbol, Error, URL, Buffer,
        };
        const c = vm.createContext(sandbox);
        const value = vm.runInContext(`(function(){return eval(${JSON.stringify(code)});})()`, c, { timeout: 5000 });
        const valueStr = format(value);
        return { ok: true, summary: `eval ok → ${valueStr.slice(0, 120)}`, result: { value }, raw: valueStr + (logs.length ? `\n[logs]\n${logs.join("\n")}` : "") };
      }
      if (op === "run") {
        const file = String(input.file ?? "");
        if (!file) return { ok: false, summary: "run: missing file", error: "BAD_INPUT" };
        const target = path.resolve(ctx.sandboxRoot, file);
        if (!target.startsWith(path.resolve(ctx.sandboxRoot))) return { ok: false, summary: "run: escapes sandbox", error: "ESCAPE" };
        const runner = String(input.runner ?? "bun");
        const r = await sh(ctx.sandboxRoot, `${runner} ${target}`);
        return { ok: r.exitCode === 0, summary: `${runner} ${file} → exit ${r.exitCode}`, result: { exitCode: r.exitCode }, raw: r.stdout + (r.stderr ? `\n[stderr]\n${r.stderr}` : ""), error: r.exitCode === 0 ? undefined : `EXIT_${r.exitCode}` };
      }
      return { ok: false, summary: `unknown code op: ${op}`, error: "UNKNOWN_OP" };
    } catch (e) { return { ok: false, summary: `code ${op} failed: ${e instanceof Error ? e.message : String(e)}`, error: String(e) }; }
  },
};

export const apiTool: Tool = {
  name: "api",
  description: "Outbound HTTP. Operations: request",
  operations: ["request"],
  async execute(op, input) {
    if (op !== "request") return { ok: false, summary: `unknown api op: ${op}`, error: "UNKNOWN_OP" };
    const url = String(input.url ?? "");
    const method = String(input.method ?? "GET").toUpperCase();
    if (!url || !/^https?:\/\//.test(url)) return { ok: false, summary: "api: invalid url", error: "BAD_INPUT" };
    const headers = input.headers as Record<string, string> | undefined;
    const body = input.body !== undefined ? (typeof input.body === "string" ? input.body : JSON.stringify(input.body)) : undefined;
    const timeoutMs = Math.min(Number(input.timeoutMs ?? 30_000), 60_000);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, { method, headers, body: body && method !== "GET" && method !== "HEAD" ? body : undefined, signal: controller.signal });
      clearTimeout(timer);
      const text = await res.text();
      const ok = res.status >= 200 && res.status < 300;
      return { ok, summary: `${method} ${url} → ${res.status} [${text.length}b]`, result: { status: res.status }, raw: text.slice(0, 1_000_000), error: ok ? undefined : `HTTP_${res.status}` };
    } catch (e) { return { ok: false, summary: `api failed: ${e instanceof Error ? e.message : String(e)}`, error: String(e) }; }
  },
};

export const browserTool: Tool = {
  name: "browser",
  description: "Web search + page reader via z-ai-web-dev-sdk. Operations: search, fetch",
  operations: ["search", "fetch"],
  async execute(op, input) {
    try {
      const ZAI = await import("z-ai-web-dev-sdk").catch(() => null);
      if (!ZAI || !ZAI.default) return { ok: false, summary: "browser: SDK unavailable", error: "SDK_UNAVAILABLE" };
      const sdk = await ZAI.default.create();
      if (op === "search") {
        const q = String(input.query ?? "");
        if (!q) return { ok: false, summary: "search: missing query", error: "BAD_INPUT" };
        const count = Math.min(Math.max(Number(input.count ?? 8), 1), 20);
        const res = await sdk.functions.invoke("web_search", { query: q, num: count });
        const items = Array.isArray(res) ? res : (Array.isArray((res as { results?: unknown[] })?.results) ? (res as { results: unknown[] }).results : []);
        const results = items.slice(0, count).map((r) => {
          const item = r as Record<string, unknown>;
          return { title: String(item.name ?? item.title ?? ""), url: String(item.url ?? item.link ?? ""), snippet: item.snippet ? String(item.snippet) : undefined };
        });
        return { ok: true, summary: `search "${q}" → ${results.length} results`, result: { query: q, count: results.length, results }, raw: JSON.stringify(results, null, 2) };
      }
      if (op === "fetch") {
        const url = String(input.url ?? "");
        if (!url || !/^https?:\/\//.test(url)) return { ok: false, summary: "fetch: invalid url", error: "BAD_INPUT" };
        const res = await sdk.functions.invoke("page_reader", { url }) as { data?: { title?: string; html?: string; publishedTime?: string } };
        const data = res?.data ?? {};
        return { ok: true, summary: `fetched ${url}`, result: { url, title: data.title, publishedTime: data.publishedTime }, raw: data.html ? data.html.slice(0, 50_000) : "" };
      }
      return { ok: false, summary: `unknown browser op: ${op}`, error: "UNKNOWN_OP" };
    } catch (e) { return { ok: false, summary: `browser ${op} failed: ${e instanceof Error ? e.message : String(e)}`, error: String(e) }; }
  },
};

export const gitTool: Tool = {
  name: "git",
  description: "Git ops. Operations: init, status, add, commit, log",
  operations: ["init", "status", "add", "commit", "log"],
  async execute(op, input, ctx) {
    try {
      const cwd = ctx.sandboxRoot;
      if (op === "init") { const r = await sh(cwd, "git init"); return { ok: r.exitCode === 0, summary: `git init → ${r.exitCode}`, raw: r.stdout }; }
      if (op === "status") { const r = await sh(cwd, "git status --porcelain"); return { ok: r.exitCode === 0, summary: `status → ${r.stdout.split("\n").filter(Boolean).length} files`, raw: r.stdout }; }
      if (op === "add") { const paths = Array.isArray(input.paths) ? (input.paths as unknown[]).map(String) : [String(input.path ?? ".")]; const r = await sh(cwd, `git add ${paths.map((p) => `'${p.replace(/'/g, "")}'`).join(" ")}`); return { ok: r.exitCode === 0, summary: `add → ${r.exitCode}`, raw: r.stdout }; }
      if (op === "commit") { const msg = String(input.message ?? ""); if (!msg) return { ok: false, summary: "commit: missing message", error: "BAD_INPUT" }; const r = await sh(cwd, `git -c user.email=genesis@shadow.os -c user.name=GENESIS commit -m '${msg.replace(/'/g, "")}'`); return { ok: r.exitCode === 0, summary: `commit → ${r.exitCode}`, raw: r.stdout }; }
      if (op === "log") { const n = Math.min(Number(input.limit ?? 20), 100); const r = await sh(cwd, `git log --max-count=${n} --pretty=format:"%h|%an|%ad|%s"`); return { ok: r.exitCode === 0, summary: `log → ${r.stdout.split("\n").length} commits`, raw: r.stdout }; }
      return { ok: false, summary: `unknown git op: ${op}`, error: "UNKNOWN_OP" };
    } catch (e) { return { ok: false, summary: `git ${op} failed: ${e instanceof Error ? e.message : String(e)}`, error: String(e) }; }
  },
};

export const packageTool: Tool = {
  name: "package",
  description: "Package manager ops. Operations: install, add, run",
  operations: ["install", "add", "run"],
  async execute(op, input, ctx) {
    try {
      const cwd = ctx.sandboxRoot;
      const pm = "bun";
      if (op === "install") { const r = await sh(cwd, `${pm} install`, 180_000); return { ok: r.exitCode === 0, summary: `install → ${r.exitCode}`, raw: r.stdout.slice(-3000), error: r.exitCode === 0 ? undefined : `EXIT_${r.exitCode}` }; }
      if (op === "add") { const pkgs = Array.isArray(input.packages) ? (input.packages as unknown[]).map(String) : [String(input.pkg)].filter(Boolean); if (!pkgs.length) return { ok: false, summary: "add: missing", error: "BAD_INPUT" }; const dev = input.dev ? " -d" : ""; const r = await sh(cwd, `${pm} add${dev} ${pkgs.map((p) => `'${p.replace(/'/g, "")}'`).join(" ")}`, 120_000); return { ok: r.exitCode === 0, summary: `add → ${r.exitCode}`, raw: r.stdout.slice(-3000) }; }
      if (op === "run") { const s = String(input.script ?? ""); if (!s) return { ok: false, summary: "run: missing script", error: "BAD_INPUT" }; const r = await sh(cwd, `${pm} run ${s}`, 240_000); return { ok: r.exitCode === 0, summary: `run ${s} → ${r.exitCode}`, raw: r.stdout.slice(-5000), error: r.exitCode === 0 ? undefined : `EXIT_${r.exitCode}` }; }
      return { ok: false, summary: `unknown package op: ${op}`, error: "UNKNOWN_OP" };
    } catch (e) { return { ok: false, summary: `package ${op} failed: ${e instanceof Error ? e.message : String(e)}`, error: String(e) }; }
  },
};

const REGISTRY: Record<string, Tool> = {
  filesystem: filesystemTool, terminal: terminalTool, code: codeTool, api: apiTool,
  browser: browserTool, git: gitTool, package: packageTool,
};

/** Per-agent tool permissions (V3 Phase 9). */
const PERMISSIONS: Record<string, string[]> = {
  CEO: ["filesystem", "terminal", "memory", "browser"],
  RESEARCH: ["filesystem", "browser", "memory", "api"],
  ARCHITECT: ["filesystem", "terminal", "git", "package", "code", "memory"],
  ENGINEERING: ["filesystem", "terminal", "git", "package", "code", "memory"],
  DESIGN: ["filesystem", "memory", "browser"],
  GROWTH: ["filesystem", "browser", "memory", "api"],
  QUALITY: ["filesystem", "terminal", "code", "git", "memory"],
  DEPLOYMENT: ["filesystem", "terminal", "git", "package", "api", "memory"],
  SECURITY: ["filesystem", "terminal", "code", "memory"],
  OPPORTUNITY: ["browser", "memory", "api", "filesystem"],
  REVENUE: ["filesystem", "memory", "browser"],
  INTERNET: ["browser", "api", "memory", "filesystem"],
  VENTURE: ["filesystem", "memory", "browser", "api"],
};

export function canUseTool(agent: string, toolName: string): boolean {
  const allow = PERMISSIONS[agent.toUpperCase()];
  if (!allow) return true; // unknown agent → allow all (sandboxed anyway)
  return allow.includes(toolName);
}

export function getTool(name: string): Tool | undefined { return REGISTRY[name]; }
export function listTools(): Tool[] { return Object.values(REGISTRY); }

export async function invokeTool(name: string, operation: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput> {
  if (!canUseTool(ctx.agent, name)) return { ok: false, summary: `permission denied: ${ctx.agent} cannot use ${name}`, error: "PERMISSION_DENIED" };
  const tool = getTool(name);
  if (!tool) return { ok: false, summary: `unknown tool: ${name}`, error: "UNKNOWN_TOOL" };
  return tool.execute(operation, input, ctx);
}

function format(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  try { return JSON.stringify(v); } catch { return String(v); }
}
