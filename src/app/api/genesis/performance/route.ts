import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import {
  performanceOverview, performanceBenchmark, queueStatus, enqueue, dequeue,
  completeTask, failTask, cancelTask, reconcileDeps, invalidateNamespace,
  invalidateByTag, optimizeModelChoice, compressPrompt,
} from "@/lib/genesis/agent-runtime/performance";
import type { ModelCapability } from "@/lib/genesis/agent-runtime/model-registry";

/** GET /api/genesis/performance — perf center overview.
 *  ?benchmark=1 (measured before/after)  ?queue=<name>  ?optimize=<capability>
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("benchmark") === "1") return NextResponse.json(await performanceBenchmark());
  const q = searchParams.get("queue");
  if (q) return NextResponse.json(await queueStatus(q));
  const opt = searchParams.get("optimize");
  if (opt) return NextResponse.json(await optimizeModelChoice(opt as ModelCapability));
  return NextResponse.json(await performanceOverview());
}

/** POST /api/genesis/performance — { action, ... }.
 *  actions: enqueue | dequeue | complete | fail | cancel | reconcile | compress | invalidate
 */
export async function POST(req: NextRequest) {
  const g = await guardWrite(req, "MEMBER");
  if (!g.ok) return g.res;
  const b = await req.json().catch(() => ({}));
  const { action } = b as { action?: string };

  switch (action) {
    case "enqueue": {
      if (!b.kind) return NextResponse.json({ error: "kind required" }, { status: 400 });
      return NextResponse.json(await enqueue({ queue: b.queue, kind: b.kind, priority: b.priority, dependsOn: b.dependsOn, payload: b.payload, dedupe: b.dedupe, maxAttempts: b.maxAttempts }));
    }
    case "dequeue":
      return NextResponse.json((await dequeue(b.queue)) ?? { empty: true });
    case "complete": {
      if (!b.taskId) return NextResponse.json({ error: "taskId required" }, { status: 400 });
      await completeTask(String(b.taskId), b.result, b.latencyMs);
      return NextResponse.json({ ok: true });
    }
    case "fail": {
      if (!b.taskId) return NextResponse.json({ error: "taskId required" }, { status: 400 });
      return NextResponse.json(await failTask(String(b.taskId), String(b.error ?? "failed")));
    }
    case "cancel": {
      if (!b.taskId) return NextResponse.json({ error: "taskId required" }, { status: 400 });
      const r = await cancelTask(String(b.taskId));
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    case "reconcile":
      return NextResponse.json({ promoted: await reconcileDeps(b.queue) });
    case "compress": {
      if (typeof b.prompt !== "string") return NextResponse.json({ error: "prompt required" }, { status: 400 });
      return NextResponse.json(compressPrompt(b.prompt));
    }
    case "invalidate": {
      if (b.tag) return NextResponse.json({ invalidated: await invalidateByTag(String(b.tag)) });
      if (b.namespace) return NextResponse.json({ invalidated: await invalidateNamespace(String(b.namespace)) });
      return NextResponse.json({ error: "tag or namespace required" }, { status: 400 });
    }
    default:
      return NextResponse.json({ error: "action must be enqueue|dequeue|complete|fail|cancel|reconcile|compress|invalidate" }, { status: 400 });
  }
}
