import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import { db } from "@/lib/db";
import { getMemoryEngine } from "@/lib/genesis/agent-runtime/memory/engine";
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const engine = searchParams.get("engine") ?? "recall";
  const type = searchParams.get("type") as "EPISODIC" | "SEMANTIC" | "PROCEDURAL" | null;
  const q = searchParams.get("q") ?? "";
  const tags = searchParams.get("tags")?.split(",").filter(Boolean) ?? [];
  const limit = Number(searchParams.get("limit") ?? 25);
  if (engine === "raw") {
    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (q) where.OR = [{ title: { contains: q } }, { content: { contains: q } }];
    const memory = await db.memoryEntry.findMany({ where, orderBy: [{ importance: "desc" }, { createdAt: "desc" }], take: limit });
    return NextResponse.json({ memory });
  }
  const results = await getMemoryEngine().recall({ query: q, type: type ?? undefined, tags, limit });
  return NextResponse.json({ memory: results, count: results.length, engine: "recall" });
}
export async function POST(req: NextRequest) {
  const _a = await guardWrite(req, "MEMBER"); if (!_a.ok) return _a.res;
  const body = await req.json();
  const created = await getMemoryEngine().record({ type: body.type, title: body.title, content: body.content, tags: body.tags ?? [], importance: body.importance ?? 5, source: body.source });
  return NextResponse.json({ memory: created });
}
