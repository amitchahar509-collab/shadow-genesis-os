/** V10 Module 2 — Autonomous Customer Acquisition. Real leads (evidence URLs),
 *  approval-gated outreach (never auto-sent), reply feedback into the reality loop.
 *  Network-free via an injected fetch seam; no fabricated companies/people/emails. */

import { test, expect, beforeEach, afterAll } from "bun:test";
import { db } from "@/lib/db";
import { computeProductDNA } from "@/lib/genesis/agent-runtime/demand";
import {
  generateICP, discoverLeads, scoreLead, generateOutreach, queueForApproval, decideDraft,
  markSent, recordInteraction, customerIntelligence, runAcquisition,
} from "@/lib/genesis/agent-runtime/acquisition-engine";
import type { FetchLike } from "@/lib/genesis/agent-runtime/world-scanner/connectors";

// a fake GitHub + HN payload so lead discovery runs fully offline
const fakeFetch: FetchLike = async (url) => {
  const body = url.includes("api.github.com")
    ? { items: [
        { name: "toggl", full_name: "toggl/track", html_url: "https://github.com/toggl/track", description: "time tracking tool for teams", stargazers_count: 1200, owner: { login: "toggl", html_url: "https://github.com/toggl", type: "Organization" } },
        { name: "clockify", full_name: "clockify/app", html_url: "https://github.com/clockify/app", description: "free time tracker", stargazers_count: 800, owner: { login: "clockify", html_url: "https://github.com/clockify", type: "Organization" } },
      ] }
    : url.includes("hn.algolia.com")
    ? { hits: [{ title: "Show HN: Timeular – time tracking hardware", url: "https://timeular.com", objectID: "999", author: "founder", points: 120, num_comments: 40 }] }
    : {};
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
};

const DNA_SUBJECT = "ACQTEST time tracker";
async function makeDna() {
  return computeProductDNA({ subject: DNA_SUBJECT, problem: "freelancers waste hours on manual time tracking", targetUsers: "freelancers and small teams", features: ["automatic time tracking", "invoicing"] });
}

async function wipe() {
  const dnas = await db.productDNA.findMany({ where: { subject: DNA_SUBJECT }, select: { dnaId: true } });
  const dnaIds = dnas.map((d) => d.dnaId);
  const allLeads = await db.lead.findMany({ where: { OR: [{ subject: { contains: "ACQTEST" } }, { dnaId: { in: dnaIds } }] }, select: { leadId: true } });
  for (const l of allLeads) {
    await db.leadInteraction.deleteMany({ where: { leadId: l.leadId } });
    await db.outreachDraft.deleteMany({ where: { leadId: l.leadId } });
  }
  await db.lead.deleteMany({ where: { OR: [{ subject: { contains: "ACQTEST" } }, { dnaId: { in: dnaIds } }] } });
  await db.productDNA.deleteMany({ where: { subject: DNA_SUBJECT } });
  await db.realitySignal.deleteMany({ where: { source: { startsWith: "acquisition:" } } });
}

beforeEach(wipe);
afterAll(wipe);

test("ICP generator produces a labeled HEURISTIC profile with decision-maker roles + confidence", async () => {
  const dna = await makeDna();
  const icp = await generateICP(dna);
  expect(icp.label).toBe("HEURISTIC");
  expect(icp.decisionMakers.length).toBeGreaterThan(0);
  expect(icp.confidence).toBeGreaterThanOrEqual(0);
  expect(icp.confidence).toBeLessThanOrEqual(100);
  expect(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]).toContain(icp.buyingIntent);
  expect(icp.budgetEstimate).toContain("ESTIMATED");
});

test("lead scoring explains WHY and tiers on real keyword/competitor overlap", async () => {
  const dna = await makeDna();
  const strong = scoreLead({ name: "Toggl", source: "github-orgs", evidenceUrl: "https://github.com/toggl", description: "time tracking and invoicing for teams", signalText: "time tracking invoicing", contactType: "PUBLIC_URL", engagement: 1000 }, dna);
  const weak = scoreLead({ name: "Random", source: "github-orgs", evidenceUrl: "https://github.com/x", description: "a database driver", signalText: "sql", contactType: "PUBLIC_URL", engagement: 1 }, dna);
  expect(strong.icpScore).toBeGreaterThan(weak.icpScore);
  expect(strong.matchReason).toContain("keyword");
  expect(["HIGH", "MEDIUM", "LOW"]).toContain(strong.matchTier);
});

test("discovery persists ONLY real leads with evidence URLs (no fabricated people/emails)", async () => {
  const dna = await makeDna();
  const r = await discoverLeads({ dna, subject: "ACQTEST-opp", fetchImpl: fakeFetch });
  expect(r.found).toBeGreaterThan(0);
  const leads = await db.lead.findMany({ where: { dnaId: dna.dnaId } });
  for (const l of leads) {
    expect(l.evidenceUrl).toMatch(/^https?:\/\//); // real URL required
    expect(l.dataLabel).toBe("REAL");
    expect(["PUBLIC_URL", "NONE", "UNKNOWN"]).toContain(l.contactType); // never a fabricated email
    expect(l.contactRef ?? "").not.toContain("@"); // no invented email addresses, ever
  }
  // idempotent: re-running doesn't duplicate the same evidence URL
  const again = await discoverLeads({ dna, subject: "ACQTEST-opp", fetchImpl: fakeFetch });
  const count = await db.lead.count({ where: { dnaId: dna.dnaId } });
  expect(count).toBe(leads.length);
  expect(again.found).toBe(r.found);
});

test("discovery under test env without a fetch seam touches NO network", async () => {
  const dna = await makeDna();
  const r = await discoverLeads({ dna }); // no fetchImpl
  expect(r.found).toBe(0);
  expect(r.connectorErrors._).toContain("NETWORK_DISABLED_IN_TESTS");
});

test("outreach stays DRAFT (heuristic offline) and respects channel length", async () => {
  const dna = await makeDna();
  const disc = await discoverLeads({ dna, fetchImpl: fakeFetch });
  const lead = disc.leads[0];
  const d = await generateOutreach(lead.leadId, "TWITTER_DM");
  expect("draftId" in d).toBe(true);
  const draft = await db.outreachDraft.findFirst({ where: { leadId: lead.leadId } });
  expect(draft!.status).toBe("DRAFT"); // never auto-anything
  expect(draft!.mode).toBe("HEURISTIC"); // llm disabled in tests
  expect(draft!.body.length).toBeLessThanOrEqual(280);
});

test("APPROVAL GATE: a draft cannot be sent without an explicit human approval", async () => {
  const dna = await makeDna();
  const disc = await discoverLeads({ dna, fetchImpl: fakeFetch });
  const lead = disc.leads.find((l) => l.matchTier !== "LOW") ?? disc.leads[0];
  const drafted = await generateOutreach(lead.leadId, "EMAIL") as { draftId: string };

  // cannot mark sent before approval
  expect((await markSent(drafted.draftId, "human")).ok).toBe(false);

  const q = await queueForApproval(drafted.draftId) as { requestId: string };
  expect(q.requestId).toMatch(/^APR-/);
  expect((await db.outreachDraft.findUnique({ where: { draftId: drafted.draftId } }))!.status).toBe("PENDING_APPROVAL");
  // still cannot send while only pending
  expect((await markSent(drafted.draftId, "human")).ok).toBe(false);

  const dec = await decideDraft(drafted.draftId, { approve: true, decidedBy: "operator" });
  expect(dec.status).toBe("APPROVED");
  const sent = await markSent(drafted.draftId, "operator"); // explicit human action
  expect(sent.ok).toBe(true);
  expect((await db.outreachDraft.findUnique({ where: { draftId: drafted.draftId } }))!.status).toBe("SENT");
  expect((await db.lead.findUnique({ where: { leadId: lead.leadId } }))!.status).toBe("CONTACTED");
});

test("rejection blocks send and records the decision", async () => {
  const dna = await makeDna();
  const disc = await discoverLeads({ dna, fetchImpl: fakeFetch });
  const drafted = await generateOutreach(disc.leads[0].leadId, "EMAIL") as { draftId: string };
  await queueForApproval(drafted.draftId);
  const dec = await decideDraft(drafted.draftId, { approve: false, decidedBy: "operator", note: "off-brand" });
  expect(dec.status).toBe("REJECTED");
  expect((await markSent(drafted.draftId, "operator")).ok).toBe(false);
});

test("reply tracking feeds REAL outcomes into the reality loop + advances CRM status", async () => {
  const dna = await makeDna();
  const disc = await discoverLeads({ dna, fetchImpl: fakeFetch });
  const lead = disc.leads[0];
  const conv = await recordInteraction(lead.leadId, "BECAME_CUSTOMER", { note: "signed up" }) as { interactionId: string; signalId?: string };
  expect(conv.interactionId).toMatch(/^INT-/);
  expect(conv.signalId).toBeTruthy(); // a real RealitySignal was produced
  expect((await db.lead.findUnique({ where: { leadId: lead.leadId } }))!.status).toBe("CUSTOMER");
  const sig = await db.realitySignal.findUnique({ where: { signalId: conv.signalId! } });
  expect(sig!.kind).toBe("CONVERSION");
});

test("customer intelligence turns recurring REAL objections into improvement tasks", async () => {
  const dna = await makeDna();
  const disc = await discoverLeads({ dna, fetchImpl: fakeFetch });
  // two real leads log the same objection theme
  for (const l of disc.leads.slice(0, 2)) await recordInteraction(l.leadId, "REPLY_NOT_INTERESTED", { note: "too expensive for our budget" });
  const intel = await customerIntelligence();
  const price = intel.objections.find((o) => o.theme === "price");
  expect(price!.count).toBeGreaterThanOrEqual(2);
  expect(intel.tasksCreated.length).toBeGreaterThanOrEqual(1); // recurring → task
});

test("runAcquisition wires the whole pipeline end-to-end (DNA→ICP→leads→draft)", async () => {
  const r = await runAcquisition({ subject: DNA_SUBJECT, problem: "freelancers waste hours on manual time tracking", targetUsers: "freelancers", features: ["automatic time tracking"], fetchImpl: fakeFetch });
  expect(r.dnaId).toMatch(/^DNA-/);
  expect(r.icp.label).toBe("HEURISTIC");
  expect(r.discovery.found).toBeGreaterThan(0);
  expect(r.topDraft?.draftId).toMatch(/^OUT-/); // a draft was prepared for the best-fit lead
});
