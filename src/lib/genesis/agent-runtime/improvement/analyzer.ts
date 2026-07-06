/** Execution Analyzer — post-execution self-improvement. */

import { db } from "@/lib/db";
import { emit, events } from "../event-bus";

export interface AnalysisResult {
  executionId: string;
  agent: string;
  whatWorked: string[];
  whatFailed: string[];
  whatWastedTime: string[];
  recommendations: string[];
  failureCategory: string | null;
  improvementTaskIds: string[];
}

const SLOW_TOOL_THRESHOLD_MS = 10_000;

export async function analyzeExecution(executionId: string): Promise<AnalysisResult | null> {
  const exec = await db.agentExecution.findUnique({ where: { executionId } });
  if (!exec) return null;
  const existing = await db.executionAnalysis.findUnique({ where: { executionId } });
  if (existing) return null;

  const toolCalls = await db.toolCall.findMany({ where: { executionId }, orderBy: { createdAt: "asc" } });
  const whatWorked: string[] = [];
  const whatFailed: string[] = [];
  const whatWastedTime: string[] = [];
  const recommendations: string[] = [];
  let failureCategory: string | null = null;

  for (const tc of toolCalls) {
    if (tc.status === "SUCCESS" && tc.durationMs < 1_000) whatWorked.push(`${tc.tool}.${tc.operation} fast (${tc.durationMs}ms)`);
    else if (tc.status === "ERROR") {
      whatFailed.push(`${tc.tool}.${tc.operation} failed: ${tc.errorMessage ?? "unknown"}`);
      if (!failureCategory) failureCategory = categorizeFailure(tc.errorMessage ?? "");
    } else if (tc.durationMs > SLOW_TOOL_THRESHOLD_MS) {
      whatWastedTime.push(`${tc.tool}.${tc.operation} slow (${tc.durationMs}ms)`);
      recommendations.push(`Optimize ${tc.tool}.${tc.operation} — took ${tc.durationMs}ms`);
    }
  }

  if (exec.status === "FAILED" && !failureCategory) failureCategory = categorizeFailure(exec.error ?? "");

  const improvementTaskIds: string[] = [];
  if (whatWastedTime.length > 0 || whatFailed.length > 0) {
    const lastTaskNum = await db.genesisTask.findFirst({ orderBy: { taskId: "desc" }, select: { taskId: true } });
    const nextNum = lastTaskNum ? (parseInt(lastTaskNum.taskId.replace("T-", ""), 10) || 0) + 1 : 1;
    const taskId = `T-${nextNum.toString().padStart(3, "0")}`;
    try {
      await db.genesisTask.create({
        data: {
          taskId, title: `Improve ${exec.agent}: ${whatFailed.length} failures, ${whatWastedTime.length} slow tools`,
          description: `Auto-generated from execution ${executionId}.\n\nWorked: ${whatWorked.join("; ")}\nFailed: ${whatFailed.join("; ")}\nSlow: ${whatWastedTime.join("; ")}\nRecommendations: ${recommendations.join("; ")}`,
          ownerAgent: exec.agent, department: "ai_systems", priority: "MEDIUM", status: "PENDING",
          dependencies: "[]", expectedArtifact: "improvement", validation: "verified", estimatedHours: 1,
        },
      });
      improvementTaskIds.push(taskId);
    } catch {}
  }

  await db.executionAnalysis.create({
    data: {
      executionId, agent: exec.agent,
      whatWorked: JSON.stringify(whatWorked), whatFailed: JSON.stringify(whatFailed),
      whatWastedTime: JSON.stringify(whatWastedTime), recommendations: JSON.stringify(recommendations),
      improvementTaskIds: JSON.stringify(improvementTaskIds), failureCategory,
    },
  });
  await emit(events.memory("ANALYZER", `analyzed ${executionId}: ${whatWorked.length} ok, ${whatFailed.length} fail, ${whatWastedTime.length} slow → ${improvementTaskIds.length} improvement tasks`));
  return { executionId, agent: exec.agent, whatWorked, whatFailed, whatWastedTime, recommendations, failureCategory, improvementTaskIds };
}

function categorizeFailure(err: string): string {
  const l = err.toLowerCase();
  if (/timeout|timed out/.test(l)) return "TIMEOUT";
  if (/module not found|cannot find module|enoent/.test(l)) return "MISSING_DEP";
  if (/syntaxerror|unexpected token/.test(l)) return "CODE_ERROR";
  if (/llm_timeout|sdk_unavailable|empty_response/.test(l)) return "LLM_FAILURE";
  if (/permission_denied/.test(l)) return "PERMISSION_DENIED";
  return "UNKNOWN";
}
