import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publishPlugin, syncFromRegistry, installPlugin, publishVersion, benchmarkPlugin, refreshAll, rankPlugins, type PluginKind, type PluginSource } from "@/lib/genesis/agent-runtime/plugins";
import { guard, audit } from "@/lib/genesis/agent-runtime/auth";

/** GET /api/genesis/plugins — the marketplace, ranked by trust.
 *  ?kind=AGENT|TOOL|WORKFLOW  ?limit=50  ?id=PLG-000001 (with versions)  ?refresh=1 (recompute from real data)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id") ?? undefined;
  if (id) {
    const plugin = await db.plugin.findUnique({ where: { pluginId: id }, include: { versions: { orderBy: { version: "desc" } } } });
    if (!plugin) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ plugin });
  }
  const kind = (searchParams.get("kind") as PluginKind) ?? undefined;
  const plugins = await rankPlugins({ kind, limit: Math.min(Number(searchParams.get("limit")) || 50, 200), refresh: searchParams.has("refresh") });
  return NextResponse.json({ plugins });
}

/** POST /api/genesis/plugins — publish / sync / install / version / benchmark / refresh.
 *  { action: "sync" }
 *  { action: "publish", kind, refKey, name?, description?, source? }
 *  { action: "install"|"benchmark"|"version"|"refresh", pluginId, changelog?, config? }
 */
export async function POST(req: NextRequest) {
  const g = await guard(req.headers.get("authorization"), "MEMBER");
  if (!g.ok) return NextResponse.json({ error: g.error }, { status: g.status });
  const body = await req.json().catch(() => ({}));
  const { action, pluginId, kind, refKey, name, description, source, changelog, config } = body as Record<string, unknown>;

  switch (action) {
    case "sync": {
      const r = await syncFromRegistry();
      await audit(g.principal, "PLUGIN_SYNC", `${r.published} published`);
      return NextResponse.json(r);
    }
    case "publish": {
      if (!kind || !refKey) return NextResponse.json({ error: "kind and refKey required" }, { status: 400 });
      const r = await publishPlugin({ kind: kind as PluginKind, refKey: String(refKey), name: name as string, description: description as string, source: source as PluginSource });
      if ("error" in r) return NextResponse.json(r, { status: 400 });
      await audit(g.principal, "PLUGIN_PUBLISH", r.pluginId);
      return NextResponse.json(r);
    }
    case "install": {
      if (!pluginId) return NextResponse.json({ error: "pluginId required" }, { status: 400 });
      const r = await installPlugin(String(pluginId));
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      await audit(g.principal, "PLUGIN_INSTALL", String(pluginId));
      return NextResponse.json(r);
    }
    case "version": {
      if (!pluginId) return NextResponse.json({ error: "pluginId required" }, { status: 400 });
      const r = await publishVersion(String(pluginId), { changelog: changelog as string, config: config as Record<string, unknown> });
      return NextResponse.json("error" in r ? r : r, { status: "error" in r ? 400 : 200 });
    }
    case "benchmark": {
      if (!pluginId) return NextResponse.json({ error: "pluginId required" }, { status: 400 });
      const r = await benchmarkPlugin(String(pluginId));
      return NextResponse.json("error" in r ? r : r, { status: "error" in r ? 400 : 200 });
    }
    case "refresh":
      return NextResponse.json({ refreshed: await refreshAll() });
    default:
      return NextResponse.json({ error: "action must be sync|publish|install|version|benchmark|refresh" }, { status: 400 });
  }
}
