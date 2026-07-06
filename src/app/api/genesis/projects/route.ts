import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET() { const projects = await db.project.findMany({ orderBy: { createdAt: "desc" } }); return NextResponse.json({ projects }); }
export async function POST(req: NextRequest) {
  const { name, mission, type, priority } = await req.json();
  if (!name || !mission) return NextResponse.json({ error: "name and mission required" }, { status: 400 });
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const project = await db.project.create({ data: { key, name, mission, type: type ?? "PRODUCT", priority: priority ?? "MEDIUM" } });
  return NextResponse.json({ project });
}
