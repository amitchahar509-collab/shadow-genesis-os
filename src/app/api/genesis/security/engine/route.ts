import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import {
  securityOverview, scanForSecrets, screenPrompt, assessCommand, assessFile,
  auditDependencies, toCycloneDX, toSPDX, readComponents, selfHeal,
  firewallPrompt, scanAndLogSecrets, securityHeaders,
} from "@/lib/genesis/agent-runtime/security-engine";

/** GET /api/genesis/security/engine — Module 6 dashboard (threat score, timeline).
 *  ?sbom=<repoPath>&format=cyclonedx|spdx  ·  ?deps=<repoPath>
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sbom = searchParams.get("sbom");
  if (sbom) {
    const comps = await readComponents(sbom);
    if ("error" in comps) return NextResponse.json(comps, { status: 400 });
    return NextResponse.json(searchParams.get("format") === "spdx" ? toSPDX(comps) : toCycloneDX(comps));
  }
  const deps = searchParams.get("deps");
  if (deps) return NextResponse.json(await auditDependencies(deps));
  return NextResponse.json(await securityOverview(), { headers: securityHeaders() });
}

/** POST /api/genesis/security/engine — { action, ... }. Detection only; never fabricates.
 *  actions: scan-secrets | screen-prompt | assess-command | assess-file | self-heal
 */
export async function POST(req: NextRequest) {
  const g = await guardWrite(req, "MEMBER");
  if (!g.ok) return g.res;
  const b = await req.json().catch(() => ({}));
  const { action } = b as { action?: string };

  switch (action) {
    case "scan-secrets": {
      if (typeof b.text !== "string") return NextResponse.json({ error: "text required" }, { status: 400 });
      const r = await scanAndLogSecrets(b.text, b.source ?? "api");
      return NextResponse.json({ found: r.found, kinds: r.kinds, redactedHits: scanForSecrets(b.text).map((h) => ({ kind: h.kind, severity: h.severity, redacted: h.redacted })) });
    }
    case "screen-prompt": {
      if (typeof b.text !== "string") return NextResponse.json({ error: "text required" }, { status: 400 });
      return NextResponse.json(b.log ? await firewallPrompt(b.text, b.source ?? "api") : screenPrompt(b.text));
    }
    case "assess-command": {
      if (typeof b.command !== "string") return NextResponse.json({ error: "command required" }, { status: 400 });
      return NextResponse.json(assessCommand(b.command));
    }
    case "assess-file": {
      if (!b.name) return NextResponse.json({ error: "name required" }, { status: 400 });
      return NextResponse.json(assessFile({ name: b.name, sizeBytes: b.sizeBytes, declaredMime: b.declaredMime }));
    }
    case "self-heal":
      return NextResponse.json(await selfHeal({ apply: !!b.apply }));
    default:
      return NextResponse.json({ error: "action must be scan-secrets|screen-prompt|assess-command|assess-file|self-heal" }, { status: 400 });
  }
}
