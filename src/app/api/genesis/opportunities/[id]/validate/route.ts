import { NextRequest, NextResponse } from "next/server";
import { BusinessValidationAgent } from "@/lib/genesis/agent-runtime/agents/v4-validation";
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = new BusinessValidationAgent();
  const result = await agent.execute({ goal: id, context: { opportunityId: id } });
  return NextResponse.json({ result });
}
