import { NextResponse } from "next/server";
import { db } from "@/lib/db";
export async function GET() {
  const [executions, tasks, opportunities, projects, agents, messages, findings, missions] = await Promise.all([
    db.agentExecution.count(),
    db.genesisTask.count(),
    db.opportunity.count(),
    db.project.count(),
    db.agentState.count(),
    db.agentMessage.count(),
    db.securityFinding.count(),
    db.deploymentRecord.count(),
  ]);
  return NextResponse.json({
    capabilities: ["agent-runtime", "multi-agent-graph", "task-orchestrator", "tool-system", "sandbox-runtime", "engineering-factory", "memory-brain", "deployment-monitor", "observability", "security-layer", "human-ceo-controls", "internet-operator", "opportunity-discovery", "business-validation", "revenue-intelligence", "growth-os", "multi-company", "agent-evolution", "knowledge-graph", "reality-feedback", "self-audit"],
    counts: { executions, tasks, opportunities, projects, agents, messages, findings, missions },
    agents: ["CEO", "RESEARCH", "ARCHITECT", "ENGINEERING", "DESIGN", "GROWTH", "QUALITY", "DEPLOYMENT", "SECURITY", "OPPORTUNITY", "BUSINESS_VALIDATION", "REVENUE", "INTERNET"],
  });
}
