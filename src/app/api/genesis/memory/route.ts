import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/genesis/memory?type=&q=
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const q = searchParams.get("q");
  const where: Record<string, unknown> = {};
  if (type) where.type = type;
  if (q) {
    where.OR = [{ title: { contains: q } }, { content: { contains: q } }];
  }
  const memory = await db.memoryEntry.findMany({
    where,
    orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({ memory });
}

// POST — create a memory entry
export async function POST(req: NextRequest) {
  const body = await req.json();
  const created = await db.memoryEntry.create({
    data: {
      type: body.type,
      title: body.title,
      content: body.content,
      tags: body.tags ?? "[]",
      importance: body.importance ?? 5,
      source: body.source ?? null,
    },
  });
  return NextResponse.json({ memory: created });
}
