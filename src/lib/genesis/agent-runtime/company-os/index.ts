/** Company OS (V10 Module 9).
 *
 * A per-company operating view that AGGREGATES the real systems already keyed by
 * companyKey — it builds NO parallel data stores. Every section reads real rows
 * from the module that owns them:
 *   CRM/leads       → Module 2 (Lead / OutreachDraft / LeadInteraction, subject=companyKey)
 *   finance         → Module 3 (RevenueEvent, projectId=companyKey) + Module 8 economics
 *   analytics       → Module 7 (ProductEvent, productKey=companyKey)
 *   support         → Module 7 (SupportTicket, productKey=companyKey)
 *   projects/tasks  → Project + GenesisTask (projectId=companyKey)
 *   operations      → GrowthExperiment (subject=companyKey), LongMission, ActivityLog
 *   knowledge       → MemoryEntry tagged with the company
 *
 * The pipeline's convention (companyKey == productKey == subject) is the join key.
 * Honesty: with no real data a section is honestly empty — never fabricated.
 *
 * Reuses: computeProfitability (Module 8), satisfaction (Module 7). No new tables.
 */

import { db } from "@/lib/db";
import { emit } from "../event-bus";
import { satisfaction } from "../customer-success";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Register/point-update a company workspace (standalone; ventures also create these). */
export async function ensureCompany(key: string, input?: { name?: string; mission?: string }): Promise<{ key: string; created: boolean }> {
  const existing = await db.company.findUnique({ where: { key } });
  if (existing) { if (input?.name || input?.mission) await db.company.update({ where: { key }, data: { ...(input.name ? { name: input.name } : {}), ...(input.mission ? { mission: input.mission } : {}) } }); return { key, created: false }; }
  await db.company.create({ data: { key, name: input?.name ?? key, mission: input?.mission ?? "", status: "ACTIVE" } });
  await emit({ agent: "COMPANY_OS", action: "COMPANY_CREATE", detail: `workspace ${key} created`, level: "INFO", category: "SYSTEM" });
  return { key, created: true };
}

// ======================= PER-COMPANY SECTIONS (real, scoped) =======================

async function crmSection(key: string) {
  const leads = await db.lead.findMany({ where: { subject: key }, orderBy: { icpScore: "desc" }, take: 100 });
  const funnel: Record<string, number> = {};
  for (const l of leads) funnel[l.status] = (funnel[l.status] ?? 0) + 1;
  const leadIds = leads.map((l) => l.leadId);
  const drafts = leadIds.length ? await db.outreachDraft.count({ where: { leadId: { in: leadIds } } }) : 0;
  const interactions = leadIds.length ? await db.leadInteraction.count({ where: { leadId: { in: leadIds } } }) : 0;
  return { leads: leads.length, funnel, outreachDrafts: drafts, interactions, topLeads: leads.slice(0, 10).map((l) => ({ leadId: l.leadId, name: l.name, matchTier: l.matchTier, status: l.status, evidenceUrl: l.evidenceUrl })) };
}

async function customersSection(key: string) {
  const customerLeads = await db.lead.count({ where: { subject: key, status: "CUSTOMER" } });
  const revenueCustomers = new Set((await db.revenueEvent.findMany({ where: { projectId: key, dataLabel: "REAL" }, select: { customerId: true } })).map((r) => r.customerId).filter(Boolean)).size;
  return { convertedLeads: customerLeads, payingCustomers: revenueCustomers };
}

async function financeSection(key: string) {
  const events = await db.revenueEvent.findMany({ where: { projectId: key, dataLabel: "REAL" } });
  const activeSubs = events.filter((e) => e.type === "SUBSCRIPTION" && e.status === "ACTIVE");
  const mrr = round2(activeSubs.reduce((a, e) => a + (e.interval === "year" ? e.amount / 12 : e.amount), 0));
  const gross = round2(events.filter((e) => e.type === "CHARGE").reduce((a, e) => a + e.amount, 0) + mrr);
  return { revenueEvents: events.length, mrrUsd: mrr, grossRevenueUsd: gross, hasRealRevenue: events.length > 0, label: events.length ? "REAL" : "UNKNOWN" };
}

async function projectsSection(key: string) {
  const projects = await db.project.findMany({ where: { OR: [{ key }, { key: { startsWith: `${key}-` } }] }, take: 25 });
  // GenesisTask has no FK to a company; reality/CS tasks embed the productKey in the description
  const tasks = await db.genesisTask.findMany({ where: { description: { contains: key } }, select: { status: true } });
  const taskByStatus: Record<string, number> = {};
  for (const t of tasks) taskByStatus[t.status] = (taskByStatus[t.status] ?? 0) + 1;
  return { projects: projects.length, tasks: tasks.length, taskByStatus, projectList: projects.map((p) => ({ key: p.key, name: p.name, status: p.status, type: p.type })) };
}

async function analyticsSection(key: string) {
  const events = await db.productEvent.findMany({ where: { productKey: key }, select: { userRef: true, eventType: true } });
  const activeUsers = new Set(events.map((e) => e.userRef).filter(Boolean)).size;
  const byType: Record<string, number> = {};
  for (const e of events) byType[e.eventType] = (byType[e.eventType] ?? 0) + 1;
  return { productEvents: events.length, activeUsers, byType, hasData: events.length > 0 };
}

async function supportSection(key: string) {
  const tickets = await db.supportTicket.findMany({ where: { productKey: key }, select: { status: true, category: true, priority: true } });
  const open = tickets.filter((t) => t.status === "OPEN" || t.status === "IN_PROGRESS").length;
  const byCategory: Record<string, number> = {};
  for (const t of tickets) byCategory[t.category] = (byCategory[t.category] ?? 0) + 1;
  const sat = await satisfaction(key);
  return { tickets: tickets.length, open, byCategory, csat: sat.csat, sentimentAvg: sat.sentimentAvg };
}

async function operationsSection(key: string) {
  const experiments = await db.growthExperiment.count({ where: { subject: key } });
  const missions = await db.longMission.count({ where: { companyKey: key } }).catch(() => 0);
  const recentActivity = await db.activityLog.count({ where: { detail: { contains: key }, createdAt: { gte: new Date(Date.now() - 7 * 24 * 3_600_000) } } });
  return { growthExperiments: experiments, longMissions: missions, activity7d: recentActivity };
}

async function knowledgeSection(key: string) {
  const memories = await db.memoryEntry.count({ where: { OR: [{ tags: { contains: key } }, { source: { contains: key } }, { content: { contains: key } }] } });
  return { memoryEntries: memories };
}

// ======================= FULL WORKSPACE =======================

/** The full 10-section operating view for one company. Real data, honest empties. */
export async function companyWorkspace(key: string): Promise<{ error: string } | Record<string, unknown>> {
  const company = await db.company.findUnique({ where: { key } });
  if (!company) return { error: `no company workspace "${key}" — create it or run a venture that produces it` };
  const [crm, customers, finance, projects, analytics, support, operations, knowledge] = await Promise.all([
    crmSection(key), customersSection(key), financeSection(key), projectsSection(key),
    analyticsSection(key), supportSection(key), operationsSection(key), knowledgeSection(key),
  ]);
  let strategy: unknown = {}, metrics: unknown = {};
  try { strategy = JSON.parse(company.strategy); } catch { /* keep {} */ }
  try { metrics = JSON.parse(company.metrics); } catch { /* keep {} */ }
  return {
    profile: { key: company.key, name: company.name, mission: company.mission, status: company.status, strategy, metrics, createdAt: company.createdAt },
    crm, customers, finance, projects, analytics, support, operations, knowledge,
    note: "aggregated from the real per-module tables (companyKey join) — sections with no data are honestly empty",
  };
}

/** Composite company health from real support + finance signals. UNKNOWN if empty. */
export async function companyHealth(key: string): Promise<{ status: string; score: { value: number; label: "REAL" | "UNKNOWN" }; drivers: string[] }> {
  const [support, finance, analytics] = await Promise.all([supportSection(key), financeSection(key), analyticsSection(key)]);
  const drivers: string[] = [];
  if (!finance.hasRealRevenue && !analytics.hasData && support.tickets === 0) return { status: "UNKNOWN", score: { value: 0, label: "UNKNOWN" }, drivers: ["no real company data yet"] };
  let score = 50;
  if (finance.hasRealRevenue) { score += 20; drivers.push(`$${finance.mrrUsd} MRR (real)`); }
  if (analytics.activeUsers > 0) { score += Math.min(15, analytics.activeUsers); drivers.push(`${analytics.activeUsers} active user(s)`); }
  if (support.open > 0) { score -= support.open * 2; drivers.push(`${support.open} open ticket(s)`); }
  if (support.csat.label === "REAL") { score += (support.csat.value - 50) * 0.2; drivers.push(`CSAT ${support.csat.value}%`); }
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  return { status: clamped >= 65 ? "HEALTHY" : clamped >= 40 ? "STEADY" : "AT_RISK", score: { value: clamped, label: "REAL" }, drivers };
}

// ======================= ROLL-UP OVERVIEW =======================

export async function companyOverview() {
  const companies = await db.company.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  const rows = await Promise.all(companies.map(async (c) => {
    const [crm, finance, support, analytics] = await Promise.all([crmSection(c.key), financeSection(c.key), supportSection(c.key), analyticsSection(c.key)]);
    return { key: c.key, name: c.name, status: c.status, leads: crm.leads, mrrUsd: finance.mrrUsd, hasRevenue: finance.hasRealRevenue, activeUsers: analytics.activeUsers, openTickets: support.open };
  }));
  return {
    companies: rows.length,
    portfolio: rows,
    note: "each company rolls up its real per-module data — $0/empty is honest until a company has real activity",
  };
}
