/** Autonomous Customer Acquisition Engine (V10 Module 2).
 *
 * Pipeline: Product DNA → ICP → Lead Discovery (real public sources) → Customer
 * Matching → Outreach Draft → Approval Queue → CRM → Reply Tracking → feedback
 * into the Reality/Demand/Evolution loop → Customer Intelligence → improvement tasks.
 *
 * HARD RULES (enforced in code, not just docs):
 *  - Genesis NEVER contacts anyone automatically. Outreach is DRAFT; queuing a
 *    send requires an ApprovalRequest; marking SENT requires a human decision.
 *  - No fabricated companies/people/emails. Every Lead has a REAL evidence URL;
 *    contacts are real public pages or honestly UNKNOWN/NONE.
 *  - Labels everywhere: REAL (fetched) · HEURISTIC (scored/inferred) · UNKNOWN.
 *
 * Reuses: demand.computeProductDNA/matchDemand (ICP substrate), approvals
 * (queue), reality-feedback.ingestSignal (reply loop), router.callLlmRouted
 * (outreach copy). No system is rebuilt or duplicated.
 */

import { db } from "@/lib/db";
import { emit } from "../event-bus";
import { computeProductDNA, matchDemand, type ProductDNAResult } from "../demand";
import { requestApproval, decide } from "../approvals";
import { ingestSignal } from "../reality-feedback";
import { callLlmRouted } from "../router";
import { LEAD_CONNECTORS, leadConnectorHealth, type LeadCandidate } from "./lead-connectors";
import type { FetchLike } from "../world-scanner/connectors";

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(x)));
const llmDisabled = () => process.env.NODE_ENV === "test" && process.env.GENESIS_TEST_ALLOW_LLM !== "1";

// ---------------- id minting (numeric max-scan, never count()+1) ----------------
async function nextId(prefix: string, rows: { id: string }[]): Promise<string> {
  let max = 0;
  for (const r of rows) { const m = r.id.match(new RegExp(`^${prefix}-(\\d+)$`)); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `${prefix}-${(max + 1).toString().padStart(6, "0")}`;
}
const nextLeadId = async () => nextId("LEAD", (await db.lead.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { leadId: true } })).map((r) => ({ id: r.leadId })));
const nextDraftId = async () => nextId("OUT", (await db.outreachDraft.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { draftId: true } })).map((r) => ({ id: r.draftId })));
const nextInteractionId = async () => nextId("INT", (await db.leadInteraction.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { interactionId: true } })).map((r) => ({ id: r.interactionId })));

// ======================= 2. ICP GENERATOR =======================

export interface ICP {
  industry: string; companySize: string; pain: string; buyingIntent: string;
  urgency: string; budgetEstimate: string; decisionMakers: string[]; confidence: number;
  label: "HEURISTIC"; segments: { industry: string; marketFit: number; urgency: string; whyNow: string }[];
}

/** Ideal Customer Profile from the Product DNA + demand segments (HEURISTIC — no
 *  real buyer data yet; every inferred field is labeled). */
export async function generateICP(dna: ProductDNAResult): Promise<ICP> {
  const match = await matchDemand(dna).catch(() => null);
  const seg = match?.segments ?? [];
  const top = seg[0];
  const kw = dna.keywords.join(" ").toLowerCase();
  // size/budget bands are HEURISTIC from category, not observed
  const enterprise = /enterprise|compliance|security|team|org/.test(kw);
  const companySize = enterprise ? "50–500 (mid-market)" : "1–50 (SMB / startup)";
  const budgetEstimate = enterprise ? "$500–5,000/mo (ESTIMATED)" : "$20–500/mo (ESTIMATED)";
  const roles = dna.category === "Devtools" ? ["Engineering Lead", "CTO", "DevEx"]
    : dna.category === "Fintech" ? ["Finance Lead", "Ops", "Founder"]
    : dna.category === "Marketing" ? ["Growth Lead", "CMO", "Founder"]
    : ["Founder", "Head of Product", "Ops Lead"];
  const buyingIntent = top && top.urgency === "HIGH" ? "HIGH" : top && top.marketFit >= 55 ? "MEDIUM" : "LOW";
  const confidence = clamp((match?.demandScore ?? 30) * 0.6 + (seg.length >= 3 ? 30 : 10));
  return {
    industry: top?.industry ?? dna.category ?? "UNKNOWN",
    companySize, pain: dna.problem.slice(0, 200),
    buyingIntent, urgency: top?.urgency ?? "MEDIUM",
    budgetEstimate, decisionMakers: roles, confidence, label: "HEURISTIC",
    segments: seg.map((sg) => ({ industry: sg.industry, marketFit: sg.marketFit, urgency: sg.urgency, whyNow: sg.whyNow })),
  };
}

// ======================= 1+3. LEAD DISCOVERY + MATCHING =======================

const realFetch: FetchLike = async (url, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    // Product Hunt connector passes its GraphQL body through an x-body header
    const xbody = init?.headers?.["x-body"];
    const r = await fetch(url, xbody ? { method: "POST", headers: init!.headers, body: xbody, signal: controller.signal } : { headers: init?.headers, signal: controller.signal });
    return { ok: r.ok, status: r.status, json: () => r.json(), text: () => r.text() };
  } finally { clearTimeout(timer); }
};

/** Score a real lead candidate against the Product DNA (HEURISTIC, explainable). */
export function scoreLead(cand: LeadCandidate, dna: ProductDNAResult): { icpScore: number; matchTier: string; matchReason: string; buyingIntent: string } {
  const hay = `${cand.name} ${cand.description} ${cand.signalText}`.toLowerCase();
  const hitKw = dna.keywords.filter((k) => k.length > 3 && hay.includes(k.toLowerCase()));
  const hitAlt = dna.alternatives.filter((a) => a.length > 3 && hay.includes(a.toLowerCase()));
  const engagementBonus = Math.min(20, Math.log2(cand.engagement + 1) * 3);
  const icpScore = clamp(hitKw.length * 16 + hitAlt.length * 10 + engagementBonus);
  const matchTier = icpScore >= 60 ? "HIGH" : icpScore >= 30 ? "MEDIUM" : "LOW";
  const reasons: string[] = [];
  if (hitKw.length) reasons.push(`matches ${hitKw.length} product keyword(s): ${hitKw.slice(0, 4).join(", ")}`);
  if (hitAlt.length) reasons.push(`mentions a known alternative/competitor: ${hitAlt.slice(0, 2).join(", ")}`);
  if (cand.engagement > 0) reasons.push(`real public engagement ${cand.engagement}`);
  const buyingIntent = hitAlt.length ? "HIGH" : hitKw.length >= 2 ? "MEDIUM" : "LOW"; // competitor-aware = actively shopping
  return { icpScore, matchTier, matchReason: reasons.join("; ") || "weak signal — low fit", buyingIntent };
}

export interface DiscoverResult { dnaId: string; scanned: string[]; connectorErrors: Record<string, string>; found: number; leads: { leadId: string; name: string; matchTier: string; icpScore: number; evidenceUrl: string }[] }

/** Discover REAL potential-customer leads for a Product DNA and store them ranked. */
export async function discoverLeads(input: { dna: ProductDNAResult; subject?: string; limit?: number; fetchImpl?: FetchLike }): Promise<DiscoverResult> {
  const { dna } = input;
  const fetchImpl = input.fetchImpl ?? realFetch;
  if (!input.fetchImpl && llmDisabled()) {
    return { dnaId: dna.dnaId, scanned: [], connectorErrors: { _: "NETWORK_DISABLED_IN_TESTS: inject fetchImpl" }, found: 0, leads: [] };
  }
  const query = (dna.keywords.slice(0, 3).join(" ") || dna.subject).slice(0, 80);
  const usable = LEAD_CONNECTORS.filter((c) => c.available() && c.find);
  const scanned: string[] = [];
  const connectorErrors: Record<string, string> = {};
  const candidates: LeadCandidate[] = [];
  await Promise.all(usable.map(async (c) => {
    try { const r = await c.find!(query, fetchImpl); scanned.push(c.name); candidates.push(...r); }
    catch (e) { connectorErrors[c.name] = e instanceof Error ? e.message : String(e); }
  }));

  // dedupe by evidence URL, score, rank, persist top N
  const seen = new Set<string>();
  const unique = candidates.filter((c) => { const k = c.evidenceUrl || c.name; if (!k || seen.has(k)) return false; seen.add(k); return true; });
  const scored = unique.map((c) => ({ c, ...scoreLead(c, dna) })).sort((a, b) => b.icpScore - a.icpScore).slice(0, input.limit ?? 15);

  const leads: DiscoverResult["leads"] = [];
  for (const { c, icpScore, matchTier, matchReason, buyingIntent } of scored) {
    // idempotent per (dna, evidenceUrl)
    const existing = await db.lead.findFirst({ where: { dnaId: dna.dnaId, evidenceUrl: c.evidenceUrl } });
    if (existing) { leads.push({ leadId: existing.leadId, name: existing.name, matchTier: existing.matchTier, icpScore: existing.icpScore, evidenceUrl: existing.evidenceUrl }); continue; }
    const leadId = await nextLeadId();
    await db.lead.create({ data: {
      leadId, dnaId: dna.dnaId, subject: input.subject ?? dna.opportunityId ?? null,
      name: c.name.slice(0, 120), source: c.source, evidenceUrl: c.evidenceUrl, description: c.description,
      industry: dna.category || "UNKNOWN", contactType: c.contactType, contactRef: c.contactRef ?? null,
      signalText: c.signalText, icpScore, matchTier, matchReason, buyingIntent,
      status: matchTier === "LOW" ? "NEW" : "QUALIFIED", dataLabel: "REAL",
    } });
    leads.push({ leadId, name: c.name, matchTier, icpScore, evidenceUrl: c.evidenceUrl });
  }
  await emit({ agent: "ACQUISITION", action: "LEAD_DISCOVERY", detail: `${leads.length} real lead(s) for ${dna.dnaId} from ${scanned.join(",") || "no connectors"}`, level: "INFO", category: "GROWTH" });
  return { dnaId: dna.dnaId, scanned, connectorErrors, found: leads.length, leads };
}

// ======================= 4. OUTREACH GENERATOR =======================

export type Channel = "EMAIL" | "LINKEDIN" | "TWITTER_DM" | "CONTACT_FORM";
const CHANNEL_LIMITS: Record<Channel, number> = { EMAIL: 900, LINKEDIN: 500, TWITTER_DM: 280, CONTACT_FORM: 600 };

function heuristicOutreach(lead: { name: string; matchReason: string; signalText: string }, dna: ProductDNAResult, channel: Channel): { subject: string; body: string; followUps: string[] } {
  const value = `${dna.subject} — ${dna.problem}`.slice(0, 120);
  const subject = channel === "EMAIL" ? `Quick idea for ${lead.name}` : "";
  const hook = lead.signalText ? `Saw ${lead.name} in the context of "${lead.signalText.slice(0, 80)}".` : `Noticed ${lead.name}'s work in this space.`;
  const body = [`Hi ${lead.name} team,`, hook, `We're building ${value}. Given ${lead.matchReason || "your focus"}, it might save your users real time.`, `Worth a quick look? Happy to share a demo — no pressure.`].join("\n\n").slice(0, CHANNEL_LIMITS[channel]);
  const followUps = [`Following up on the above — any interest in a 10-min look?`, `Last note from me — if timing's off, when should I check back?`];
  return { subject, body, followUps };
}

/** Draft outreach for a lead. LLM when available, HEURISTIC fallback. Stays DRAFT. */
export async function generateOutreach(leadId: string, channel: Channel = "EMAIL"): Promise<{ draftId: string; mode: string } | { error: string }> {
  const lead = await db.lead.findUnique({ where: { leadId } });
  if (!lead) return { error: "lead not found" };
  if (!lead.dnaId) return { error: "lead has no Product DNA to pitch" };
  const dnaRow = await db.productDNA.findUnique({ where: { dnaId: lead.dnaId } });
  if (!dnaRow) return { error: "Product DNA missing" };
  const dna: ProductDNAResult = { dnaId: dnaRow.dnaId, subject: dnaRow.subject, problem: dnaRow.problem, category: dnaRow.category, features: JSON.parse(dnaRow.features), targetUsers: dnaRow.targetUsers, alternatives: JSON.parse(dnaRow.alternatives), keywords: JSON.parse(dnaRow.keywords), opportunityId: dnaRow.opportunityId ?? undefined };

  let mode = "HEURISTIC";
  let draft = heuristicOutreach(lead, dna, channel);
  if (!llmDisabled()) {
    const r = await callLlmRouted({
      system: `You write concise, honest B2B cold outreach. No hype, no fake urgency, no fabricated stats. ${CHANNEL_LIMITS[channel]} char max for the body. Return JSON: {"subject":"...","body":"...","followUps":["...","..."]}. For non-email channels subject is "".`,
      user: `Channel: ${channel}\nProspect: ${lead.name} (${lead.industry})\nWhy they fit: ${lead.matchReason}\nReal signal: ${lead.signalText.slice(0, 200)}\nOur product: ${dna.subject} — solves: ${dna.problem}\nOur value vs alternatives (${dna.alternatives.join(", ") || "n/a"}): be specific and honest.`,
    }, { agent: "GROWTH", importance: "LOW" }).catch(() => null);
    if (r?.ok && r.text) {
      try {
        const p = JSON.parse(r.text.replace(/```json|```/g, "").trim()) as { subject?: string; body?: string; followUps?: string[] };
        if (p.body) { draft = { subject: (p.subject ?? "").slice(0, 160), body: p.body.slice(0, CHANNEL_LIMITS[channel]), followUps: (p.followUps ?? []).slice(0, 3) }; mode = "LLM"; }
      } catch { /* keep heuristic */ }
    }
  }

  const draftId = await nextDraftId();
  await db.outreachDraft.create({ data: { draftId, leadId, channel, subject: draft.subject, body: draft.body, followUps: JSON.stringify(draft.followUps), status: "DRAFT", mode } });
  if (lead.status === "QUALIFIED" || lead.status === "NEW") await db.lead.update({ where: { leadId }, data: { status: "DRAFTED" } });
  await emit({ agent: "ACQUISITION", action: "OUTREACH_DRAFT", detail: `${draftId} ${channel} draft for ${lead.name} (${mode})`, level: "INFO", category: "GROWTH" });
  return { draftId, mode };
}

// ======================= 5. APPROVAL QUEUE =======================

/** Queue a draft for HUMAN approval. Never sends. Creates a real ApprovalRequest. */
export async function queueForApproval(draftId: string, opts?: { executionId?: string }): Promise<{ requestId: string } | { error: string }> {
  const draft = await db.outreachDraft.findUnique({ where: { draftId } });
  if (!draft) return { error: "draft not found" };
  if (draft.status !== "DRAFT" && draft.status !== "EDITED") return { error: `draft is ${draft.status}, not queueable` };
  const lead = await db.lead.findUnique({ where: { leadId: draft.leadId } });
  const appr = await requestApproval({
    agent: "ACQUISITION", actionType: "CUSTOMER_CONTACT",
    description: `Send ${draft.channel} outreach to ${lead?.name ?? draft.leadId} — REVIEW COPY BEFORE APPROVING. Genesis will NOT send automatically; approval only marks it ready for a human to send.`,
    payload: { draftId, leadId: draft.leadId, channel: draft.channel, evidenceUrl: lead?.evidenceUrl, subject: draft.subject, body: (draft.editedBody ?? draft.body).slice(0, 500) },
    executionId: opts?.executionId,
  });
  await db.outreachDraft.update({ where: { draftId }, data: { status: "PENDING_APPROVAL", approvalId: appr.requestId } });
  return { requestId: appr.requestId };
}

/** Human decision on a queued draft. approve → APPROVED (ready to send, still not sent). */
export async function decideDraft(draftId: string, opts: { approve: boolean; decidedBy: string; note?: string; editedBody?: string }): Promise<{ ok: boolean; status?: string; error?: string }> {
  const draft = await db.outreachDraft.findUnique({ where: { draftId } });
  if (!draft) return { ok: false, error: "draft not found" };
  if (!draft.approvalId) return { ok: false, error: "draft was never queued for approval" };
  const d = await decide(draft.approvalId, { approve: opts.approve, decidedBy: opts.decidedBy, note: opts.note });
  if (!d.ok) return { ok: false, error: d.error };
  const status = opts.approve ? "APPROVED" : "REJECTED";
  await db.outreachDraft.update({ where: { draftId }, data: { status, decidedBy: opts.decidedBy, ...(opts.editedBody ? { editedBody: opts.editedBody } : {}) } });
  await emit({ agent: "ACQUISITION", action: opts.approve ? "OUTREACH_APPROVED" : "OUTREACH_REJECTED", detail: `${draftId} ${status} by ${opts.decidedBy}`, level: opts.approve ? "SUCCESS" : "INFO", category: "GROWTH" });
  return { ok: true, status };
}

/** Mark an APPROVED draft as actually sent — an explicit HUMAN action (Genesis
 *  never sends). Advances the lead to CONTACTED. */
export async function markSent(draftId: string, sentBy: string): Promise<{ ok: boolean; error?: string }> {
  const draft = await db.outreachDraft.findUnique({ where: { draftId } });
  if (!draft) return { ok: false, error: "draft not found" };
  if (draft.status !== "APPROVED") return { ok: false, error: `draft is ${draft.status}, not APPROVED — cannot mark sent` };
  await db.outreachDraft.update({ where: { draftId }, data: { status: "SENT" } });
  await db.lead.update({ where: { leadId: draft.leadId }, data: { status: "CONTACTED" } });
  await emit({ agent: "ACQUISITION", action: "OUTREACH_SENT", detail: `${draftId} marked sent by ${sentBy} (human action)`, level: "INFO", category: "GROWTH" });
  return { ok: true };
}

// ======================= 7. REPLY TRACKING (feedback loop) =======================

export type InteractionKind = "REPLY_INTERESTED" | "REPLY_NOT_INTERESTED" | "NO_REPLY" | "MEETING_BOOKED" | "BECAME_CUSTOMER" | "LOST" | "NOTE";
const KIND_TO_STATUS: Partial<Record<InteractionKind, string>> = {
  REPLY_INTERESTED: "REPLIED", MEETING_BOOKED: "REPLIED", BECAME_CUSTOMER: "CUSTOMER",
  REPLY_NOT_INTERESTED: "LOST", LOST: "LOST",
};

/** Record a REAL reply/outcome (human-entered) and feed it into the reality loop.
 *  Never auto-generated — replies are real events the operator logs. */
export async function recordInteraction(leadId: string, kind: InteractionKind, opts?: { note?: string; recordedBy?: string }): Promise<{ interactionId: string; signalId?: string } | { error: string }> {
  const lead = await db.lead.findUnique({ where: { leadId } });
  if (!lead) return { error: "lead not found" };
  const interactionId = await nextInteractionId();

  // feed material outcomes back into the Reality/Demand/Evolution loop
  let signalId: string | undefined;
  const feed = async (signalKind: "CONVERSION" | "FEEDBACK", sentiment: number, detail: string) => {
    const res = await ingestSignal({ kind: signalKind, source: `acquisition:${lead.source}`, productKey: lead.subject ?? lead.dnaId ?? lead.name, subject: lead.subject ?? undefined, detail, sentiment }).catch(() => null);
    return res?.signalId;
  };
  if (kind === "BECAME_CUSTOMER") signalId = await feed("CONVERSION", 1, `Lead ${lead.name} converted to a customer (REAL)`);
  else if (kind === "REPLY_INTERESTED" || kind === "MEETING_BOOKED") signalId = await feed("CONVERSION", 0.5, `Lead ${lead.name}: ${kind} (REAL positive signal)`);
  else if (kind === "REPLY_NOT_INTERESTED" || kind === "LOST") signalId = await feed("FEEDBACK", -0.5, `Lead ${lead.name}: ${kind}${opts?.note ? ` — ${opts.note}` : ""} (REAL objection)`);

  await db.leadInteraction.create({ data: { interactionId, leadId, kind, note: opts?.note ?? "", recordedBy: opts?.recordedBy ?? "human", signalId: signalId ?? null } });
  const newStatus = KIND_TO_STATUS[kind];
  if (newStatus) await db.lead.update({ where: { leadId }, data: { status: newStatus } });
  await emit({ agent: "ACQUISITION", action: "LEAD_INTERACTION", detail: `${interactionId} ${lead.name}: ${kind}`, level: kind === "BECAME_CUSTOMER" ? "SUCCESS" : "INFO", category: "GROWTH" });
  return { interactionId, signalId };
}

// ======================= 8. CUSTOMER INTELLIGENCE =======================

/** Summarize real interactions across leads and generate improvement tasks from
 *  recurring objections/requests (COMPUTED from real logged replies only). */
export async function customerIntelligence(): Promise<{ interactions: number; objections: { theme: string; count: number }[]; tasksCreated: string[] }> {
  const rows = await db.leadInteraction.findMany({ where: { kind: { in: ["REPLY_NOT_INTERESTED", "LOST", "NOTE"] } }, orderBy: { createdAt: "desc" }, take: 200 });
  const themes = new Map<string, number>();
  for (const r of rows) {
    const note = (r.note || "").toLowerCase();
    for (const [theme, re] of Object.entries(OBJECTION_THEMES)) if (re.test(note)) themes.set(theme, (themes.get(theme) ?? 0) + 1);
  }
  const objections = [...themes.entries()].map(([theme, count]) => ({ theme, count })).sort((a, b) => b.count - a.count);
  const tasksCreated: string[] = [];
  for (const o of objections.filter((x) => x.count >= 2)) {
    // recurring real objection → an improvement signal (which the reality loop turns into a task)
    const res = await ingestSignal({ kind: "FEATURE_REQUEST", source: "acquisition:intelligence", productKey: "customer-acquisition", detail: `Recurring objection "${o.theme}" across ${o.count} real leads — address it.` }).catch(() => null);
    for (const g of res?.generated ?? []) if (g.kind === "TASK") tasksCreated.push(g.id);
  }
  return { interactions: rows.length, objections, tasksCreated };
}
const OBJECTION_THEMES: Record<string, RegExp> = {
  price: /\b(price|expensive|cost|budget|cheap|afford)\b/,
  timing: /\b(timing|later|not now|next quarter|busy)\b/,
  trust: /\b(trust|security|compliance|risk|unproven)\b/,
  fit: /\b(fit|not relevant|different|use case|need)\b/,
  competitor: /\b(already use|competitor|switch|alternative)\b/,
};

// ======================= FULL PIPELINE + QUERIES =======================

/** End-to-end (no send): DNA → ICP → discover leads → draft top lead → queue. */
export async function runAcquisition(input: { opportunityId?: string; subject?: string; problem?: string; targetUsers?: string; features?: string[]; limit?: number; fetchImpl?: FetchLike }): Promise<{ dnaId: string; icp: ICP; discovery: DiscoverResult; topDraft?: { draftId: string; leadId: string } }> {
  const dna = await computeProductDNA({ opportunityId: input.opportunityId, subject: input.subject, problem: input.problem, targetUsers: input.targetUsers, features: input.features });
  const icp = await generateICP(dna);
  const discovery = await discoverLeads({ dna, subject: input.subject ?? input.opportunityId, limit: input.limit, fetchImpl: input.fetchImpl });
  let topDraft: { draftId: string; leadId: string } | undefined;
  const best = discovery.leads.find((l) => l.matchTier !== "LOW");
  if (best) { const d = await generateOutreach(best.leadId, "EMAIL"); if ("draftId" in d) topDraft = { draftId: d.draftId, leadId: best.leadId }; }
  return { dnaId: dna.dnaId, icp, discovery, topDraft };
}

export async function acquisitionOverview() {
  const [leads, drafts, interactions] = await Promise.all([
    db.lead.findMany({ orderBy: { icpScore: "desc" }, take: 200 }),
    db.outreachDraft.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    db.leadInteraction.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
  ]);
  const funnel = { NEW: 0, QUALIFIED: 0, DRAFTED: 0, CONTACTED: 0, REPLIED: 0, CUSTOMER: 0, LOST: 0 } as Record<string, number>;
  for (const l of leads) funnel[l.status] = (funnel[l.status] ?? 0) + 1;
  const byIndustry = new Map<string, number>();
  for (const l of leads) byIndustry.set(l.industry, (byIndustry.get(l.industry) ?? 0) + 1);
  const pendingApproval = drafts.filter((d) => d.status === "PENDING_APPROVAL");
  return {
    leadCount: leads.length,
    funnel,
    industries: [...byIndustry.entries()].map(([industry, count]) => ({ industry, count })).sort((a, b) => b.count - a.count),
    approvalQueue: pendingApproval.map((d) => ({ draftId: d.draftId, leadId: d.leadId, channel: d.channel, subject: d.subject })),
    drafts: drafts.map((d) => ({ draftId: d.draftId, leadId: d.leadId, channel: d.channel, status: d.status, mode: d.mode })),
    interactions: interactions.length,
    connectorHealth: leadConnectorHealth(),
    topLeads: leads.slice(0, 25).map((l) => ({ leadId: l.leadId, name: l.name, industry: l.industry, matchTier: l.matchTier, icpScore: l.icpScore, status: l.status, evidenceUrl: l.evidenceUrl, contactType: l.contactType, dataLabel: l.dataLabel })),
  };
}

export { leadConnectorHealth };
