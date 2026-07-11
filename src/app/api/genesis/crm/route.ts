import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import { computeProductDNA } from "@/lib/genesis/agent-runtime/demand";
import {
  runAcquisition, discoverLeads, generateICP, generateOutreach, queueForApproval, decideDraft,
  markSent, recordInteraction, customerIntelligence, acquisitionOverview,
  type Channel, type InteractionKind,
} from "@/lib/genesis/agent-runtime/acquisition-engine";

/** GET /api/genesis/crm — acquisition overview: leads, funnel, approval queue, industries, connector health. */
export async function GET() {
  return NextResponse.json(await acquisitionOverview());
}

/** POST /api/genesis/crm — { action, ... }. All mutations are guarded; nothing is ever auto-sent.
 *  actions: run | discover | icp | outreach | queue | decide | sent | interaction | intelligence
 */
export async function POST(req: NextRequest) {
  const g = await guardWrite(req, "MEMBER");
  if (!g.ok) return g.res;
  const b = await req.json().catch(() => ({}));
  const { action } = b as { action?: string };

  switch (action) {
    case "run":
      return NextResponse.json(await runAcquisition({ opportunityId: b.opportunityId, subject: b.subject, problem: b.problem, targetUsers: b.targetUsers, features: b.features, limit: b.limit }));
    case "discover": {
      const dna = await computeProductDNA({ opportunityId: b.opportunityId, subject: b.subject, problem: b.problem, targetUsers: b.targetUsers, features: b.features });
      return NextResponse.json(await discoverLeads({ dna, subject: b.subject ?? b.opportunityId, limit: b.limit }));
    }
    case "icp": {
      const dna = await computeProductDNA({ opportunityId: b.opportunityId, subject: b.subject, problem: b.problem, targetUsers: b.targetUsers, features: b.features });
      return NextResponse.json({ dnaId: dna.dnaId, icp: await generateICP(dna) });
    }
    case "outreach": {
      if (!b.leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 });
      const r = await generateOutreach(String(b.leadId), (b.channel as Channel) ?? "EMAIL");
      return NextResponse.json(r, { status: "error" in r ? 400 : 200 });
    }
    case "queue": {
      if (!b.draftId) return NextResponse.json({ error: "draftId required" }, { status: 400 });
      const r = await queueForApproval(String(b.draftId));
      return NextResponse.json(r, { status: "error" in r ? 400 : 200 });
    }
    case "decide": {
      if (!b.draftId || typeof b.approve !== "boolean") return NextResponse.json({ error: "draftId and approve required" }, { status: 400 });
      const r = await decideDraft(String(b.draftId), { approve: b.approve, decidedBy: g.principal.userId ?? "human", note: b.note, editedBody: b.editedBody });
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    case "sent": {
      if (!b.draftId) return NextResponse.json({ error: "draftId required" }, { status: 400 });
      const r = await markSent(String(b.draftId), g.principal.userId ?? "human");
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    case "interaction": {
      if (!b.leadId || !b.kind) return NextResponse.json({ error: "leadId and kind required" }, { status: 400 });
      const r = await recordInteraction(String(b.leadId), b.kind as InteractionKind, { note: b.note, recordedBy: g.principal.userId ?? "human" });
      return NextResponse.json(r, { status: "error" in r ? 400 : 200 });
    }
    case "intelligence":
      return NextResponse.json(await customerIntelligence());
    default:
      return NextResponse.json({ error: "action must be run|discover|icp|outreach|queue|decide|sent|interaction|intelligence" }, { status: 400 });
  }
}
