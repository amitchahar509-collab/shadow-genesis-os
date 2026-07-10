import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import { db } from "@/lib/db";
export async function GET() { const companies = await db.company.findMany({ orderBy: { createdAt: "desc" } }); return NextResponse.json({ companies }); }
export async function POST(req: NextRequest) {
  const _a = await guardWrite(req, "MEMBER"); if (!_a.ok) return _a.res;
  const { name, mission } = await req.json();
  if (!name || !mission) return NextResponse.json({ error: "name and mission required" }, { status: 400 });
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const company = await db.company.create({ data: { key, name, mission } });
  return NextResponse.json({ company });
}
