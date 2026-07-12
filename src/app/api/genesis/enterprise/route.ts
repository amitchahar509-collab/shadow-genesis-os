import { NextRequest, NextResponse } from "next/server";
import { guardWrite } from "@/lib/api-guard";
import {
  enterpriseOverview, enterpriseHealth, complianceReport, verifyTenantIsolation,
  encryptionReadiness, secretLifecycle, exportAuditLog, setOrgPolicy, getOrgPolicy,
  checkResourceQuota, createBackup, restoreBackup, listBackups, requestGdpr, decideGdpr,
  executeGdpr, rotateApiKey, rbacMatrix, authorize,
} from "@/lib/genesis/agent-runtime/enterprise";
import type { Permission } from "@/lib/genesis/agent-runtime/enterprise";
import type { Role } from "@/lib/genesis/agent-runtime/auth";

/** GET /api/genesis/enterprise — control center.
 *  ?health=1 ?compliance=SOC2|ISO27001|GDPR|HIPAA ?isolation=1 ?encryption=1
 *  ?rbac=1 ?secrets=1 ?backups=1 ?policy=<orgId> ?audit-export=1&org=&days=
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("health") === "1") return NextResponse.json(await enterpriseHealth());
  const cf = searchParams.get("compliance");
  if (cf) return NextResponse.json(await complianceReport(cf as "SOC2"));
  if (searchParams.get("isolation") === "1") return NextResponse.json(await verifyTenantIsolation());
  if (searchParams.get("encryption") === "1") return NextResponse.json(await encryptionReadiness());
  if (searchParams.get("rbac") === "1") return NextResponse.json({ matrix: rbacMatrix() });
  if (searchParams.get("secrets") === "1") return NextResponse.json(await secretLifecycle());
  if (searchParams.get("backups") === "1") return NextResponse.json({ backups: await listBackups() });
  const pol = searchParams.get("policy");
  if (pol) return NextResponse.json(await getOrgPolicy(pol));
  if (searchParams.get("audit-export") === "1") return NextResponse.json(await exportAuditLog({ orgId: searchParams.get("org") || undefined, sinceDays: Number(searchParams.get("days")) || undefined }));
  return NextResponse.json(await enterpriseOverview());
}

/** POST /api/genesis/enterprise — { action, ... }. RBAC-gated; GDPR/backups need high roles.
 *  actions: set-policy | quota-check | backup | restore | gdpr-request | gdpr-decide | gdpr-execute | rotate-key
 */
export async function POST(req: NextRequest) {
  const g = await guardWrite(req, "MEMBER");
  if (!g.ok) return g.res;
  const role = g.principal.role as Role;
  const b = await req.json().catch(() => ({}));
  const { action } = b as { action?: string };
  const deny = (perm: Permission) => { const a = authorize(role, perm); return a.allowed ? null : NextResponse.json({ error: a.reason }, { status: 403 }); };

  switch (action) {
    case "set-policy": {
      const d = deny("manage_policy"); if (d) return d;
      if (!b.orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 });
      return NextResponse.json(await setOrgPolicy(String(b.orgId), b.policy ?? b));
    }
    case "quota-check": {
      if (!b.orgId || !b.resource) return NextResponse.json({ error: "orgId and resource required" }, { status: 400 });
      return NextResponse.json(await checkResourceQuota(String(b.orgId), b.resource));
    }
    case "backup": {
      const d = deny("manage_backups"); if (d) return d;
      return NextResponse.json(await createBackup({ orgId: b.orgId, scope: b.scope, scopeKey: b.scopeKey }));
    }
    case "restore": {
      const d = deny("manage_backups"); if (d) return d;
      if (!b.backupId) return NextResponse.json({ error: "backupId required" }, { status: 400 });
      const r = await restoreBackup(String(b.backupId));
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    case "gdpr-request": {
      const d = deny("gdpr_admin"); if (d) return d;
      if (!b.subjectType || !b.subjectKey || !b.kind) return NextResponse.json({ error: "subjectType, subjectKey, kind required" }, { status: 400 });
      return NextResponse.json(await requestGdpr({ subjectType: b.subjectType, subjectKey: b.subjectKey, kind: b.kind, requestedBy: g.principal.userId }));
    }
    case "gdpr-decide": {
      const d = deny("approve"); if (d) return d;
      if (!b.requestId || typeof b.approve !== "boolean") return NextResponse.json({ error: "requestId and approve required" }, { status: 400 });
      const r = await decideGdpr(String(b.requestId), { approve: b.approve, decidedBy: g.principal.userId });
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    case "gdpr-execute": {
      const d = deny("gdpr_admin"); if (d) return d;
      if (!b.requestId) return NextResponse.json({ error: "requestId required" }, { status: 400 });
      const r = await executeGdpr(String(b.requestId));
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    case "rotate-key": {
      const d = deny("manage_members"); if (d) return d;
      if (!b.keyId) return NextResponse.json({ error: "keyId required" }, { status: 400 });
      const r = await rotateApiKey(String(b.keyId), g.principal);
      return NextResponse.json(r, { status: "error" in r ? 400 : 200 });
    }
    default:
      return NextResponse.json({ error: "action must be set-policy|quota-check|backup|restore|gdpr-request|gdpr-decide|gdpr-execute|rotate-key" }, { status: 400 });
  }
}
