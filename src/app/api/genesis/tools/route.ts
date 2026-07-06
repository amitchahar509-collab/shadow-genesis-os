import { NextResponse } from "next/server";
import { listTools } from "@/lib/genesis/agent-runtime/tools";
export async function GET() {
  const tools = listTools().map((t) => ({ name: t.name, description: t.description, operations: t.operations }));
  return NextResponse.json({ tools, count: tools.length });
}
