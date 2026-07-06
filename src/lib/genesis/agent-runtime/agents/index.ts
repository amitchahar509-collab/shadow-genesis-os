/** Agent Registry — V4 with 11 agents. */

import type { BaseAgent } from "../base-agent";
import { CeoAgent, ResearchAgent, ArchitectAgent, EngineeringAgent, DesignAgent, GrowthAgent, QualityAgent, DeploymentAgent, SecurityAgent } from "./core";
import { OpportunityAgent } from "./v4-opportunity";
import { BusinessValidationAgent } from "./v4-validation";
import { RevenueAgent } from "./v4-revenue";
import { InternetAgent } from "./v4-internet";

type AgentCtor = new () => BaseAgent;

export const AGENT_REGISTRY: Record<string, AgentCtor> = {
  CEO: CeoAgent,
  RESEARCH: ResearchAgent,
  ARCHITECT: ArchitectAgent,
  ENGINEERING: EngineeringAgent,
  DESIGN: DesignAgent,
  GROWTH: GrowthAgent,
  QUALITY: QualityAgent,
  DEPLOYMENT: DeploymentAgent,
  SECURITY: SecurityAgent,
  OPPORTUNITY: OpportunityAgent,
  BUSINESS_VALIDATION: BusinessValidationAgent,
  REVENUE: RevenueAgent,
  INTERNET: InternetAgent,
};

export const AGENT_NAMES = Object.keys(AGENT_REGISTRY);

export function getAgent(name: string): BaseAgent | undefined {
  const Ctor = AGENT_REGISTRY[name.toUpperCase()];
  return Ctor ? new Ctor() : undefined;
}

export function describeAgents() {
  return AGENT_NAMES.map((name) => {
    const a = getAgent(name)!;
    return { name, department: a.department, description: a.description };
  });
}
