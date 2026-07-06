import { NextRequest, NextResponse } from "next/server";
import { tailLogs } from "@/lib/genesis/agent-runtime/sandbox/manager";
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(new URL(req.url).searchParams.get("n") ?? 100);
  const logs = await tailLogs(id, n);
  return NextResponse.json(logs);
}
