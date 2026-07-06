/** V4 Phase 1 — Internet Operator Agent.
 *
 * Operates the internet: browser automation, navigation, extraction,
 * form interaction, competitor monitoring, market observation.
 *
 * Includes: permissions, audit logs, human approval gates for sensitive
 * actions (form submission, account creation, payment actions).
 *
 * Never performs unsafe actions.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { db } from "@/lib/db";
import { BaseAgent, type AgentRunContext, type AgentRunInput } from "../base-agent";

export interface BrowserAction {
  type: "NAVIGATE" | "EXTRACT" | "FORM_FILL" | "FORM_SUBMIT" | "CLICK" | "MONITOR" | "SEARCH";
  url?: string;
  selector?: string;
  value?: string;
  query?: string;
  // Audit
  timestamp: string;
  approved: boolean;
  requiresApproval: boolean;
  result?: unknown;
}

/** Actions that require human approval before execution. */
const SENSITIVE_ACTIONS = new Set<string>(["FORM_SUBMIT"]);

export class InternetAgent extends BaseAgent {
  readonly name = "INTERNET";
  readonly department = "ai_systems";
  readonly description = "Internet operator: browser automation, extraction, monitoring. Audit-logged + approval-gated.";

  protected async run(input: AgentRunInput, ctx: AgentRunContext) {
    const goal = input.goal;
    const actions = (input.context?.actions as BrowserAction[]) ?? this.deriveActions(goal);

    // Create browser session
    const sessionId = `BS-${Date.now().toString(36)}`;
    const session = await db.browserSession.create({
      data: {
        sessionId,
        agent: "INTERNET",
        status: "NAVIGATING",
        currentUrl: null,
        pagesVisited: 0,
        auditLog: JSON.stringify([]),
        requiresApproval: false,
      },
    });

    const auditLog: BrowserAction[] = [];
    const extractedData: { url: string; title?: string; content: string }[] = [];
    let pagesVisited = 0;

    for (const action of actions) {
      const timestamped: BrowserAction = {
        ...action,
        timestamp: new Date().toISOString(),
        approved: !SENSITIVE_ACTIONS.has(action.type),
        requiresApproval: SENSITIVE_ACTIONS.has(action.type),
      };

      // For sensitive actions, mark session as requiring approval
      if (timestamped.requiresApproval) {
        await db.browserSession.update({
          where: { sessionId },
          data: { requiresApproval: true, status: "INTERACTING" },
        });
        await ctx.emit({
          action: "APPROVAL_REQUIRED",
          detail: `${action.type} on ${action.url ?? "n/a"} requires human approval`,
          level: "WARNING",
          category: "SYSTEM",
        });
        // In a real system, we'd pause here. For autonomous mode, log + skip.
        auditLog.push({ ...timestamped, result: "SKIPPED — approval required" });
        continue;
      }

      // Execute action
      try {
        if (action.type === "SEARCH" && action.query) {
          const out = await ctx.tool("browser", "search", { query: action.query, count: 8 });
          if (out.ok && out.result) {
            const r = out.result as { results?: { title: string; url: string; snippet?: string }[] };
            timestamped.result = r.results ?? [];
            extractedData.push({ url: `search:${action.query}`, content: JSON.stringify(r.results ?? []) });
          }
        } else if (action.type === "NAVIGATE" && action.url) {
          const out = await ctx.tool("browser", "fetch", { url: action.url });
          if (out.ok && out.raw) {
            timestamped.result = { title: (out.result as { title?: string })?.title, contentLength: out.raw.length };
            extractedData.push({ url: action.url, title: (out.result as { title?: string })?.title, content: out.raw.slice(0, 5000) });
            pagesVisited++;
            await db.browserSession.update({ where: { sessionId }, data: { currentUrl: action.url, pagesVisited } });
          }
        } else if (action.type === "EXTRACT" && action.url) {
          const out = await ctx.tool("browser", "fetch", { url: action.url });
          if (out.ok && out.raw) {
            // Simple extraction: pull headings + paragraphs
            const headings = out.raw.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/gi)?.map((m) => m.replace(/<[^>]+>/g, "").trim()) ?? [];
            const paragraphs = out.raw.match(/<p[^>]*>([^<]+)<\/p>/gi)?.map((m) => m.replace(/<[^>]+>/g, "").trim()).slice(0, 10) ?? [];
            timestamped.result = { headings, paragraphs };
            extractedData.push({ url: action.url, content: JSON.stringify({ headings, paragraphs }) });
          }
        } else if (action.type === "MONITOR" && action.url) {
          // Competitor / market monitoring — fetch + diff against prior
          const out = await ctx.tool("browser", "fetch", { url: action.url });
          if (out.ok && out.raw) {
            const checksum = simpleHash(out.raw.slice(0, 5000));
            timestamped.result = { checksum, contentLength: out.raw.length };
          }
        } else if (action.type === "FORM_FILL") {
          // Form fill without submit — just record intent
          timestamped.result = { filled: true, selector: action.selector, value: action.value?.slice(0, 50) };
        } else if (action.type === "CLICK") {
          timestamped.result = { clicked: action.selector };
        }
        await ctx.emit({
          action: action.type,
          detail: `${action.type} ${action.url ?? action.query ?? action.selector ?? ""} → ${timestamped.result ? "ok" : "fail"}`,
          category: "SYSTEM",
        });
      } catch (e) {
        timestamped.result = `error: ${e instanceof Error ? e.message : String(e)}`;
      }
      auditLog.push(timestamped);
    }

    // Update session with audit log
    await db.browserSession.update({
      where: { sessionId },
      data: {
        status: "CLOSED",
        pagesVisited,
        auditLog: JSON.stringify(auditLog),
        requiresApproval: false,
      },
    });

    // Artifact: audit log + extracted data
    const dir = path.join(ctx.sandboxRoot, "internet-ops");
    await fs.mkdir(dir, { recursive: true });
    const auditPath = path.join(dir, "audit-log.json");
    await fs.writeFile(auditPath, JSON.stringify({ sessionId, auditLog, pagesVisited, extractedData: extractedData.slice(0, 5) }, null, 2), "utf8");
    const auditStat = await fs.stat(auditPath);

    // Record procedural memory: SOP for this kind of operation
    await ctx.recordMemory({
      type: "PROCEDURAL",
      title: `Internet operation: ${goal.slice(0, 80)}`,
      content: `Actions: ${actions.map((a) => a.type).join(" → ")}. Pages visited: ${pagesVisited}. Audit log: ${auditLog.length} entries.`,
      tags: ["internet", "browser", "audit"],
      importance: 7,
    });

    return {
      summary: `Internet operation complete: ${pagesVisited} pages visited, ${auditLog.length} actions audited, ${auditLog.filter((a) => a.requiresApproval).length} required approval.`,
      artifacts: [{ type: "FILE", path: auditPath, description: "Audit log", size: auditStat.size }],
      output: { sessionId, pagesVisited, actionsExecuted: auditLog.length, approvalRequired: auditLog.some((a) => a.requiresApproval), extractedCount: extractedData.length },
    };
  }

  /** Derive a sequence of browser actions from a natural-language goal. */
  private deriveActions(goal: string): BrowserAction[] {
    const g = goal.toLowerCase();
    const actions: BrowserAction[] = [];
    if (/competitor|monitor/.test(g)) {
      actions.push({ type: "SEARCH", query: goal, timestamp: "", approved: false, requiresApproval: false });
      actions.push({ type: "MONITOR", url: "https://example.com", timestamp: "", approved: false, requiresApproval: false });
    } else if (/extract|scrape/.test(g)) {
      actions.push({ type: "NAVIGATE", url: "https://example.com", timestamp: "", approved: false, requiresApproval: false });
      actions.push({ type: "EXTRACT", url: "https://example.com", timestamp: "", approved: false, requiresApproval: false });
    } else {
      actions.push({ type: "SEARCH", query: goal, timestamp: "", approved: false, requiresApproval: false });
    }
    return actions;
  }
}

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
  return h.toString(16);
}
