import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import { db } from "@/lib/db";
export async function GET() {
  const [nodes, edges] = await Promise.all([
    db.knowledgeNode.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    db.knowledgeEdge.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  return NextResponse.json({ nodes, edges });
}
export async function POST(req: NextRequest) {
  const _a = await guardWrite(req, "MEMBER"); if (!_a.ok) return _a.res;
  const { type, label, description, properties } = await req.json();
  if (!type || !label) return NextResponse.json({ error: "type and label required" }, { status: 400 });
  const node = await db.knowledgeNode.create({ data: { type, label, description: description ?? "", properties: JSON.stringify(properties ?? {}) } });
  return NextResponse.json({ node });
}
