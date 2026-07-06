import { NextResponse } from "next/server";
import { getStatus } from "@/lib/genesis/agent-runtime/orchestrator";
export async function GET() { const status = await getStatus(); return NextResponse.json({ status }); }
