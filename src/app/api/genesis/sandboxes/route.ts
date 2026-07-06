import { NextRequest, NextResponse } from "next/server";
import { createSandbox, listSandboxes, runInSandbox, cleanupExpired } from "@/lib/genesis/agent-runtime/sandbox/manager";
export async function GET() { const sandboxes = await listSandboxes(); return NextResponse.json({ sandboxes, count: sandboxes.length }); }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const action = body.action ?? "create";
  if (action === "create") { const sb = await createSandbox({ ttlSeconds: body.ttlSeconds, executionId: body.executionId, projectId: body.projectId, port: body.port, label: body.label }); return NextResponse.json({ sandbox: sb }); }
  if (action === "run") { if (!body.sandboxId || !body.command) return NextResponse.json({ error: "sandboxId and command required" }, { status: 400 }); try { const result = await runInSandbox(body.sandboxId, body.command, { timeoutMs: body.timeoutMs, env: body.env, detach: body.detach }); return NextResponse.json({ result }); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); } }
  if (action === "cleanup-expired") { const reaped = await cleanupExpired(); return NextResponse.json({ reaped }); }
  return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
}
