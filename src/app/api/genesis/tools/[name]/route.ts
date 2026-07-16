import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import * as path from "node:path";
import { promises as fs } from "node:fs";
import { getTool } from "@/lib/genesis/agent-runtime/tools";
import type { ToolContext } from "@/lib/genesis/agent-runtime/tools/index";
import { workspaceRoot } from "@/lib/genesis/agent-runtime/workspace";
export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const _a = await guardWrite(req, "ADMIN"); if (!_a.ok) return _a.res;
  const { name } = await params;
  const body = await req.json();
  const { operation, input, sandbox } = body;
  const tool = getTool(name);
  if (!tool) return NextResponse.json({ error: `unknown tool: ${name}` }, { status: 404 });
  const sandboxRoot = path.resolve(workspaceRoot(), "manual", sandbox ?? `manual-${Date.now()}`);
  await fs.mkdir(sandboxRoot, { recursive: true });
  const ctx: ToolContext = { executionId: `MANUAL-${Date.now()}`, agent: "MANUAL", sandboxRoot, timeoutMs: 30_000 };
  const start = Date.now();
  const output = await tool.execute(operation, input, ctx);
  return NextResponse.json({ tool: name, operation, output, durationMs: Date.now() - start, sandboxRoot });
}
