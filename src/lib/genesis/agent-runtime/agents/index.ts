/** Agent Registry — V7 with 15 agents. */

import type { BaseAgent } from "../base-agent";
import { CeoAgent, ResearchAgent, ArchitectAgent, EngineeringAgent, DesignAgent, GrowthAgent, QualityAgent, DeploymentAgent, SecurityAgent } from "./core";
import { OpportunityAgent } from "./v4-opportunity";
import { BusinessValidationAgent } from "./v4-validation";
import { RevenueAgent } from "./v4-revenue";
import { InternetAgent } from "./v4-internet";
import { VentureAgent } from "./v6-venture";
import { CustomerSimulationAgent } from "./v7-customer";

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
  VENTURE: VentureAgent,
  CUSTOMER: CustomerSimulationAgent,
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
