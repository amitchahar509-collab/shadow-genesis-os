import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import { db } from "@/lib/db";
import { seedRegistry, syncWithCatalog, rankModels, type ModelCapability } from "@/lib/genesis/agent-runtime/model-registry";
import { runModelDuel, runModelBenchmark, type DuelCategory } from "@/lib/genesis/agent-runtime/model-arena";
import { routingTableDynamic, usageSummary, availableProviders } from "@/lib/genesis/agent-runtime/router";

/** GET /api/genesis/models — the Model Command Center data.
 *  ?rank=REASONING|CODING|LONG_CONTEXT|CHEAP  → ranked models for a capability
 *  ?duels=1&limit=10                          → recent duels
 *  (default) → registry + live routing + leaderboard + usage/failures
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rank = searchParams.get("rank");
  if (rank) return NextResponse.json({ capability: rank, models: await rankModels(rank as ModelCapability, { providers: availableProviders() as Set<string> }) });
  if (searchParams.has("duels")) {
    const duels = await db.modelDuel.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(Number(searchParams.get("limit")) || 10, 50) });
    return NextResponse.json({ duels: duels.map((d) => ({ ...d, entries: safeParse(d.entries) })) });
  }
  const [registry, routing, usage] = await Promise.all([
    db.modelRegistry.findMany({ orderBy: [{ active: "desc" }, { measuredWins: "desc" }, { reasoningTier: "desc" }] }),
    routingTableDynamic().catch(() => []),
    usageSummary(24 * 7),
  ]);
  return NextResponse.json({
    providers: [...availableProviders()],
    registry: registry.map((r) => ({ ...r, strengths: safeParse(r.strengths), weaknesses: safeParse(r.weaknesses), tags: safeParse(r.tags) })),
    routing, usage,
  });
}

/** POST /api/genesis/models — manage the multi-brain layer.
 *  { action: "seed" }                                  → upsert curated profiles (MEMBER)
 *  { action: "sync" }                                  → sync availability+prices from the live catalog (MEMBER)
 *  { action: "duel", task, models[], expected?, category? } → one duel (ADMIN — spends tokens)
 *  { action: "benchmark" }                             → standard duel set, updates rankings (ADMIN — spends tokens; run weekly via cron)
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { action, task, models, expected, category } = body as { action?: string; task?: string; models?: string[]; expected?: string; category?: DuelCategory };

  const role = action === "duel" || action === "benchmark" ? "ADMIN" : "MEMBER";
  const _a = await guardWrite(req, role); if (!_a.ok) return _a.res;

  try {
    switch (action) {
      case "seed": return NextResponse.json({ seeded: await seedRegistry() });
      case "sync": return NextResponse.json(await syncWithCatalog());
      case "duel": {
        if (!task || !models?.length) return NextResponse.json({ error: "task and models[] required" }, { status: 400 });
        return NextResponse.json({ duel: await runModelDuel({ task, models, expected, category }) });
      }
      case "benchmark": return NextResponse.json(await runModelBenchmark());
      default: return NextResponse.json({ error: "action must be seed|sync|duel|benchmark" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }
