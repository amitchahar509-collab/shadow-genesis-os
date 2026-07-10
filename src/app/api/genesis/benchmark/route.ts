import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import { db } from "@/lib/db";
import { runBenchmark, benchmarkTrend } from "@/lib/genesis/agent-runtime/benchmark";

/** GET /api/genesis/benchmark — benchmark history + trend.
 *  ?suite=intelligence|full  ?limit=20  ?id=BM-000001  ?trend=1
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id") ?? undefined;
  if (id) {
    const run = await db.benchmarkRun.findUnique({ where: { runId: id } });
    if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ run: { ...run, results: safeParse(run.results) } });
  }
  const suite = (searchParams.get("suite") as "intelligence" | "full") ?? "intelligence";
  if (searchParams.get("trend")) return NextResponse.json({ trend: await benchmarkTrend(suite) });
  const limit = Math.min(Number(searchParams.get("limit")) || 20, 100);
  const runs = await db.benchmarkRun.findMany({ where: suite ? { suite } : undefined, orderBy: { createdAt: "desc" }, take: limit });
  return NextResponse.json({ runs: runs.map((r) => ({ ...r, results: safeParse(r.results) })) });
}

/** POST /api/genesis/benchmark — run a suite against the live system.
 *  body: { suite?: "intelligence" | "full", background? }
 *  The full suite runs a real build mission (minutes) — defaults to background.
 */
export async function POST(req: NextRequest) {
  const _a = await guardWrite(req, "ADMIN"); if (!_a.ok) return _a.res;
  const body = await req.json().catch(() => ({}));
  const { suite, background } = body as { suite?: "intelligence" | "full"; background?: boolean };
  const s = suite === "full" ? "full" : "intelligence";
  if (background ?? s === "full") {
    runBenchmark({ suite: s }).catch(() => {});
    return NextResponse.json({ accepted: true, suite: s, note: "benchmark started; poll GET /api/genesis/benchmark" });
  }
  try {
    return NextResponse.json({ run: await runBenchmark({ suite: s }) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }
