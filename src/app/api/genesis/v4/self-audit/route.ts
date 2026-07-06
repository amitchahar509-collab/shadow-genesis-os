import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
const AUDIT_QUESTIONS = [
  "Are we solving a real problem?",
  "Is this valuable to users?",
  "Is there evidence to support our assumptions?",
  "What are we missing?",
  "Are there blind spots in our strategy?",
  "Is the cost justified by the value?",
  "Are we measuring the right things?",
  "What would happen if we stopped?",
];
export async function GET() {
  const audits = await db.selfAudit.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
  return NextResponse.json({ audits, questions: AUDIT_QUESTIONS });
}
export async function POST(req: NextRequest) {
  const { question, context } = await req.json();
  const audit = await db.selfAudit.create({ data: { question, context: JSON.stringify(context ?? {}), finding: "", recommendation: "", severity: "INFO" } });
  return NextResponse.json({ audit });
}
