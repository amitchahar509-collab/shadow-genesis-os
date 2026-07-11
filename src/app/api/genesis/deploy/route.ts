import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import {
  deploymentOverview, verifyProvider, verifyAllProviders, planDeployment, decideDeployment,
  markDeployed, checkHealth, rollback,
} from "@/lib/genesis/agent-runtime/deployment-cloud";
import type { ProviderName } from "@/lib/genesis/agent-runtime/deployment-cloud/cloud-providers";

/** GET /api/genesis/deploy — cloud deploy overview (providers, deployments, health).
 *  ?verify=<provider> verifies one provider; ?verify=all verifies all configured.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const v = searchParams.get("verify");
  if (v === "all") return NextResponse.json({ providers: await verifyAllProviders() });
  if (v) return NextResponse.json(await verifyProvider(v as ProviderName));
  return NextResponse.json(await deploymentOverview());
}

/** POST /api/genesis/deploy — { action, ... }. Cloud deploys are approval-gated.
 *  actions: plan | decide | deployed | health | rollback
 */
export async function POST(req: NextRequest) {
  const g = await guardWrite(req, "MEMBER");
  if (!g.ok) return g.res;
  const b = await req.json().catch(() => ({}));
  const { action } = b as { action?: string };

  switch (action) {
    case "plan": {
      if (!b.provider) return NextResponse.json({ error: "provider required" }, { status: 400 });
      const r = await planDeployment({ provider: b.provider, repoPath: b.repoPath, projectId: b.projectId, url: b.url, commitSha: b.commitSha, region: b.region, stack: b.stack });
      return NextResponse.json(r, { status: "error" in r ? 400 : 200 });
    }
    case "decide": {
      if (!b.deploymentId || typeof b.approve !== "boolean") return NextResponse.json({ error: "deploymentId and approve required" }, { status: 400 });
      const r = await decideDeployment(String(b.deploymentId), { approve: b.approve, decidedBy: g.principal.userId ?? "human", note: b.note });
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    case "deployed": {
      if (!b.deploymentId || !b.url) return NextResponse.json({ error: "deploymentId and url required" }, { status: 400 });
      const r = await markDeployed(String(b.deploymentId), String(b.url));
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    case "health": {
      if (!b.deploymentId) return NextResponse.json({ error: "deploymentId required" }, { status: 400 });
      const r = await checkHealth(String(b.deploymentId));
      return NextResponse.json(r, { status: "error" in r ? 400 : 200 });
    }
    case "rollback": {
      if (!b.deploymentId) return NextResponse.json({ error: "deploymentId required" }, { status: 400 });
      const r = await rollback(String(b.deploymentId));
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    default:
      return NextResponse.json({ error: "action must be plan|decide|deployed|health|rollback" }, { status: 400 });
  }
}
