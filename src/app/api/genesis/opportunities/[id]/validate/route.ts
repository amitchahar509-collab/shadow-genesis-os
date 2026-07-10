import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import { BusinessValidationAgent } from "@/lib/genesis/agent-runtime/agents/v4-validation";
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const _a = await guardWrite(req, "MEMBER"); if (!_a.ok) return _a.res;
  const { id } = await params;
  const agent = new BusinessValidationAgent();
  const result = await agent.execute({ goal: id, context: { opportunityId: id } });
  return NextResponse.json({ result });
}
