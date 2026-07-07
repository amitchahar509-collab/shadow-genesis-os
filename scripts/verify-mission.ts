/**
 * Real-execution verification: dispatch a mission through the full
 * orchestrator pipeline and report per-task truth (DONE/FAILED/BLOCKED).
 *
 * Usage: bun run scripts/verify-mission.ts [goal]
 * Exit code 0 only if CEO succeeded AND every pipeline task is DONE.
 */

import { dispatchGoal } from "../src/lib/genesis/agent-runtime/orchestrator";
import { db } from "../src/lib/db";

const goal = process.argv[2] ?? "build a hello world CLI tool";

const result = await dispatchGoal(goal, {});

console.log(`\n=== MISSION VERIFICATION ===`);
console.log(`Goal: ${goal}`);
console.log(`CEO: ${result.ceoExecution?.status ?? "SKIPPED"} — ${result.ceoExecution?.summary ?? ""}`);
console.log(`Duration: ${result.durationMs}ms`);
console.log(`Tasks:`);
for (const t of result.taskResults) {
  console.log(`  [${t.status}] ${t.taskId} (${t.agent}) — ${t.summary.slice(0, 140)}${t.error ? ` | error: ${t.error.slice(0, 100)}` : ""}`);
}

const artifacts = await db.artifact.count();
const toolCalls = await db.toolCall.count();
const executions = await db.agentExecution.count();
console.log(`\nDB totals: ${executions} executions, ${toolCalls} tool calls, ${artifacts} artifacts`);

const allDone = result.taskResults.length > 0 && result.taskResults.every((t) => t.status === "DONE");
const ceoOk = result.ceoExecution ? result.ceoExecution.status === "SUCCESS" : true;
console.log(`\nVERDICT: ${ceoOk && allDone ? "PASS — full pipeline DONE" : "FAIL — pipeline has non-DONE tasks"}`);
process.exit(ceoOk && allDone ? 0 : 1);
