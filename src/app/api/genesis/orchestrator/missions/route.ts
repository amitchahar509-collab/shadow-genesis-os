import { NextResponse } from "next/server";
import { listMissions } from "@/lib/genesis/agent-runtime/orchestrator";
export async function GET() { return NextResponse.json({ missions: listMissions() }); }
