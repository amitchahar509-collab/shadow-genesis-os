/** Agent collaboration: message bus + state manager + permission graph. */

import { db } from "@/lib/db";
import { emit, events } from "../event-bus";

export type MessageType = "DIRECTIVE" | "QUESTION" | "FINDINGS" | "APPROVE" | "REJECT" | "BLOCK" | "ALLOW" | "REQUEST_HELP" | "HELP_PROVIDED" | "DELEGATE";

export interface AgentMessage {
  id: string; messageId: string; fromAgent: string; toAgent: string;
  type: MessageType; payload: Record<string, unknown>; status: string; createdAt: Date;
}

class MessageBus {
  async send(fromAgent: string, toAgent: string, type: MessageType, payload: Record<string, unknown> = {}): Promise<AgentMessage> {
    if (!getCollaborationGraph().canSend(fromAgent, toAgent, type)) {
      throw new Error(`unauthorized: ${fromAgent} cannot send ${type} to ${toAgent}`);
    }
    const num = await db.agentMessage.count();
    const messageId = `MSG-${(num + 1).toString().padStart(6, "0")}`;
    const row = await db.agentMessage.create({ data: { messageId, fromAgent, toAgent, type, payload: JSON.stringify(payload), status: "SENT" } });
    await emit(events.decision(fromAgent, `${type} → ${toAgent}: ${JSON.stringify(payload).slice(0, 100)}`));
    return { id: row.id, messageId, fromAgent, toAgent, type, payload, status: "SENT", createdAt: row.createdAt };
  }
  async receive(toAgent: string, limit = 10): Promise<AgentMessage[]> {
    const rows = await db.agentMessage.findMany({ where: { toAgent, status: { in: ["SENT", "DELIVERED"] } }, orderBy: { createdAt: "desc" }, take: limit });
    return rows.map((r) => ({ id: r.id, messageId: r.messageId, fromAgent: r.fromAgent, toAgent: r.toAgent, type: r.type as MessageType, payload: safeParse(r.payload), status: r.status, createdAt: r.createdAt }));
  }
  async markRead(messageId: string): Promise<void> {
    await db.agentMessage.updateMany({ where: { messageId }, data: { status: "READ" } });
  }
  async list(limit = 50): Promise<AgentMessage[]> {
    const rows = await db.agentMessage.findMany({ orderBy: { createdAt: "desc" }, take: limit });
    return rows.map((r) => ({ id: r.id, messageId: r.messageId, fromAgent: r.fromAgent, toAgent: r.toAgent, type: r.type as MessageType, payload: safeParse(r.payload), status: r.status, createdAt: r.createdAt }));
  }
}
let _bus: MessageBus | null = null;
export function getMessageBus(): MessageBus { if (!_bus) _bus = new MessageBus(); return _bus; }

export type AgentStateName = "IDLE" | "THINKING" | "EXECUTING" | "REVIEWING" | "BLOCKED" | "DONE" | "PAUSED" | "OFFLINE";

const LEGAL_TRANSITIONS: Record<AgentStateName, AgentStateName[]> = {
  IDLE: ["THINKING", "EXECUTING", "PAUSED", "OFFLINE"],
  THINKING: ["EXECUTING", "IDLE", "BLOCKED", "PAUSED"],
  EXECUTING: ["REVIEWING", "DONE", "BLOCKED", "PAUSED", "OFFLINE"],
  REVIEWING: ["EXECUTING", "DONE", "IDLE", "PAUSED"],
  BLOCKED: ["THINKING", "IDLE", "PAUSED"],
  DONE: ["IDLE", "PAUSED", "OFFLINE"],
  PAUSED: ["IDLE", "OFFLINE"],
  OFFLINE: ["IDLE"],
};

class StateManager {
  async get(agent: string): Promise<{ state: AgentStateName; currentExecutionId: string | null; currentTaskId: string | null; paused: boolean; }> {
    const row = await db.agentState.findUnique({ where: { agent } });
    if (!row) return { state: "IDLE", currentExecutionId: null, currentTaskId: null, paused: false };
    return { state: row.state as AgentStateName, currentExecutionId: row.currentExecutionId, currentTaskId: row.currentTaskId, paused: row.paused };
  }
  async transition(agent: string, nextState: AgentStateName, ctx?: { executionId?: string; taskId?: string; }): Promise<void> {
    const current = await this.get(agent);
    if (current.paused && nextState !== "OFFLINE" && nextState !== "PAUSED") throw new Error(`agent ${agent} is paused`);
    if (!LEGAL_TRANSITIONS[current.state].includes(nextState)) throw new Error(`illegal transition: ${current.state} → ${nextState}`);
    await db.agentState.upsert({
      where: { agent },
      create: { agent, state: nextState, currentExecutionId: ctx?.executionId ?? null, currentTaskId: ctx?.taskId ?? null },
      update: { state: nextState, currentExecutionId: ctx?.executionId ?? null, currentTaskId: ctx?.taskId ?? null },
    });
    await emit(events.decision(agent, `state: ${current.state} → ${nextState}`));
  }
  async pause(agent: string): Promise<void> {
    await db.agentState.upsert({ where: { agent }, create: { agent, state: "PAUSED", paused: true }, update: { state: "PAUSED", paused: true } });
    await emit(events.decision(agent, `paused`));
  }
  async resume(agent: string): Promise<void> {
    const row = await db.agentState.findUnique({ where: { agent } });
    await db.agentState.upsert({ where: { agent }, create: { agent, state: "IDLE", paused: false }, update: { state: "IDLE", paused: false } });
    await emit(events.decision(agent, `resumed`));
  }
  async snapshot(): Promise<{ agent: string; state: AgentStateName; currentExecutionId: string | null; currentTaskId: string | null; paused: boolean; }[]> {
    const rows = await db.agentState.findMany({ orderBy: { agent: "asc" } });
    return rows.map((r) => ({ agent: r.agent, state: r.state as AgentStateName, currentExecutionId: r.currentExecutionId, currentTaskId: r.currentTaskId, paused: r.paused }));
  }
}
let _sm: StateManager | null = null;
export function getStateManager(): StateManager { if (!_sm) _sm = new StateManager(); return _sm; }

export const ALL_AGENTS = ["CEO", "RESEARCH", "ARCHITECT", "ENGINEERING", "DESIGN", "GROWTH", "QUALITY", "DEPLOYMENT", "SECURITY", "OPPORTUNITY", "REVENUE", "INTERNET", "VENTURE"];

const GRAPH: Record<string, { to: string; types: MessageType[] }[]> = {
  CEO: ALL_AGENTS.filter((a) => a !== "CEO").map((a) => ({ to: a, types: ["DIRECTIVE", "DELEGATE", "APPROVE", "REJECT"] })),
  RESEARCH: [{ to: "ARCHITECT", types: ["FINDINGS"] }, { to: "CEO", types: ["FINDINGS", "QUESTION"] }, { to: "GROWTH", types: ["FINDINGS"] }],
  ARCHITECT: [{ to: "ENGINEERING", types: ["DIRECTIVE", "FINDINGS"] }, { to: "CEO", types: ["FINDINGS", "APPROVE"] }],
  ENGINEERING: [{ to: "QUALITY", types: ["FINDINGS", "REQUEST_HELP"] }, { to: "DEPLOYMENT", types: ["FINDINGS"] }, { to: "CEO", types: ["FINDINGS"] }],
  QUALITY: [{ to: "ENGINEERING", types: ["REJECT", "APPROVE", "REQUEST_HELP"] }, { to: "DEPLOYMENT", types: ["BLOCK", "ALLOW"] }, { to: "SECURITY", types: ["FINDINGS"] }],
  SECURITY: [{ to: "DEPLOYMENT", types: ["BLOCK", "ALLOW"] }, { to: "CEO", types: ["FINDINGS", "BLOCK"] }],
  DEPLOYMENT: [{ to: "ENGINEERING", types: ["REQUEST_HELP"] }, { to: "CEO", types: ["FINDINGS"] }],
  GROWTH: [{ to: "REVENUE", types: ["FINDINGS"] }, { to: "CEO", types: ["FINDINGS"] }],
  OPPORTUNITY: [{ to: "CEO", types: ["FINDINGS"] }, { to: "RESEARCH", types: ["DELEGATE"] }, { to: "GROWTH", types: ["FINDINGS"] }],
  REVENUE: [{ to: "CEO", types: ["FINDINGS"] }, { to: "GROWTH", types: ["FINDINGS"] }],
  INTERNET: [{ to: "RESEARCH", types: ["FINDINGS"] }, { to: "OPPORTUNITY", types: ["FINDINGS"] }, { to: "CEO", types: ["FINDINGS"] }],
  VENTURE: [{ to: "CEO", types: ["FINDINGS"] }, { to: "OPPORTUNITY", types: ["FINDINGS"] }, { to: "GROWTH", types: ["FINDINGS"] }],
};

class CollaborationGraph {
  canSend(from: string, to: string, type: MessageType): boolean {
    if (from === to) return false;
    const edges = GRAPH[from.toUpperCase()] ?? [];
    const edge = edges.find((e) => e.to === to.toUpperCase());
    if (!edge) return false;
    return edge.types.includes(type);
  }
  getOutgoing(from: string): { to: string; types: MessageType[] }[] { return GRAPH[from.toUpperCase()] ?? []; }
  getAllAgents(): string[] { return ALL_AGENTS; }
}
let _cg: CollaborationGraph | null = null;
export function getCollaborationGraph(): CollaborationGraph { if (!_cg) _cg = new CollaborationGraph(); return _cg; }

function safeParse(s: string): Record<string, unknown> { try { return JSON.parse(s); } catch { return {}; } }
