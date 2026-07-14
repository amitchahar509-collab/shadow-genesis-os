import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import { getConfigStatus, setConfigKeys, isConfigurableKey } from "@/lib/genesis/app-config";
import { connectorHealth as actionHealth } from "@/lib/genesis/agent-runtime/action-connectors";
import { cloudProviderHealth } from "@/lib/genesis/agent-runtime/deployment-cloud/cloud-providers";
import { providerHealth as revenueHealth } from "@/lib/genesis/agent-runtime/revenue-engine/providers";
import { availableProviders } from "@/lib/genesis/agent-runtime/router";

/** GET /api/genesis/settings — masked config status + live provider/connector health. */
export async function GET() {
  return NextResponse.json({
    config: await getConfigStatus(),
    live: {
      llm: [...availableProviders()],
      action: actionHealth().map((c) => ({ name: c.name, available: c.available })),
      cloud: cloudProviderHealth().map((c) => ({ name: c.name, available: c.available })),
      revenue: revenueHealth().map((c) => ({ name: c.name, available: c.available })),
    },
    note: "secret values are never returned — only masked previews. Keys take effect immediately (in-process) and persist to a git-ignored local file.",
  });
}

/** POST /api/genesis/settings — { entries: { KEY: value, ... } }. Allowlisted keys only. */
export async function POST(req: NextRequest) {
  const g = await guardWrite(req, "ADMIN");
  if (!g.ok) return g.res;
  const b = await req.json().catch(() => ({}));
  const entries = (b.entries ?? {}) as Record<string, string>;
  if (typeof entries !== "object" || Array.isArray(entries)) return NextResponse.json({ error: "entries object required" }, { status: 400 });
  const unknown = Object.keys(entries).filter((k) => !isConfigurableKey(k));
  if (unknown.length) return NextResponse.json({ error: `not configurable: ${unknown.join(", ")}` }, { status: 400 });
  const r = await setConfigKeys(entries);
  return NextResponse.json({ ...r, status: await getConfigStatus() });
}
