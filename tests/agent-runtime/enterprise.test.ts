/** V10 Module 11 — Enterprise Hardening. RBAC, tenant isolation, quotas, backups
 *  (UNCONFIGURED without storage — never faked), GDPR (approval-gated), compliance
 *  (verified controls only, no certification claim), encryption readiness, key
 *  rotation. Extends the existing auth/approval/audit — no rebuilds. Network-free. */

import { test, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { db } from "@/lib/db";
import {
  can, authorize, rbacMatrix, verifyTenantIsolation, encryptionReadiness, rotateApiKey,
  secretLifecycle, createBackup, restoreBackup, requestGdpr, decideGdpr, executeGdpr,
  complianceReport, enterpriseHealth, setOrgPolicy, getOrgPolicy, checkResourceQuota, exportAuditLog,
} from "@/lib/genesis/agent-runtime/enterprise";
import { createApiKey, type Principal } from "@/lib/genesis/agent-runtime/auth";

const OWNER: Principal = { userId: "ENTTEST_owner", orgId: "ENTTEST_org", role: "OWNER", keyId: "k" };
const saved = { backup: process.env.GENESIS_BACKUP_TARGET, enc: process.env.GENESIS_DB_ENCRYPTION_KEY };

async function wipe() {
  await db.gdprRequest.deleteMany({ where: { subjectKey: { startsWith: "ENTTEST" } } });
  await db.backupRecord.deleteMany({ where: { orgId: { startsWith: "ENTTEST" } } });
  await db.orgPolicy.deleteMany({ where: { orgId: { startsWith: "ENTTEST" } } });
  await db.usageCounter.deleteMany({ where: { orgId: { startsWith: "ENTTEST" } } });
  await db.apiKey.deleteMany({ where: { userId: { startsWith: "ENTTEST" } } });
  await db.membership.deleteMany({ where: { userId: { startsWith: "ENTTEST" } } });
  await db.authUser.deleteMany({ where: { userId: { startsWith: "ENTTEST" } } });
  await db.organization.deleteMany({ where: { orgId: { startsWith: "ENTTEST" } } });
  await db.company.deleteMany({ where: { key: { startsWith: "ENTTEST" } } });
  await db.lead.deleteMany({ where: { subject: { startsWith: "ENTTEST" } } });
  await db.approvalRequest.deleteMany({ where: { agent: "ENTERPRISE", description: { contains: "ENTTEST" } } });
}
async function makeOrg(orgId: string) {
  await db.organization.upsert({ where: { orgId }, create: { orgId, name: orgId, slug: `${orgId.toLowerCase()}-slug` }, update: {} });
}
beforeEach(async () => { delete process.env.GENESIS_BACKUP_TARGET; delete process.env.GENESIS_DB_ENCRYPTION_KEY; await wipe(); });
afterEach(() => { if (saved.backup === undefined) delete process.env.GENESIS_BACKUP_TARGET; else process.env.GENESIS_BACKUP_TARGET = saved.backup; if (saved.enc === undefined) delete process.env.GENESIS_DB_ENCRYPTION_KEY; else process.env.GENESIS_DB_ENCRYPTION_KEY = saved.enc; });
afterAll(wipe);

// ---- RBAC ----
test("RBAC matrix: fine-grained permissions escalate with role", () => {
  expect(can("VIEWER", "read")).toBe(true);
  expect(can("VIEWER", "write")).toBe(false);
  expect(can("MEMBER", "write")).toBe(true);
  expect(can("MEMBER", "approve")).toBe(false);
  expect(can("ADMIN", "approve")).toBe(true);
  expect(can("ADMIN", "manage_policy")).toBe(false); // owner-only
  expect(can("OWNER", "gdpr_admin")).toBe(true);
  expect(can("ADMIN", "gdpr_admin")).toBe(false);
  const m = rbacMatrix();
  expect(m.find((r) => r.role === "OWNER")!.permissions.length).toBeGreaterThan(m.find((r) => r.role === "VIEWER")!.permissions.length);
});

test("authorize explains its decision", () => {
  const a = authorize("MEMBER", "delete_data");
  expect(a.allowed).toBe(false);
  expect(a.reason).toContain("needs OWNER");
});

// ---- Tenant isolation ----
test("tenant isolation verifier scores from REAL data + flags violations", async () => {
  const iso = await verifyTenantIsolation();
  expect(iso.label).toBe("REAL");
  expect(iso.checks.length).toBeGreaterThanOrEqual(4);
  expect(iso.score).toBeGreaterThanOrEqual(0);
  expect(iso.score).toBeLessThanOrEqual(100);
  // FKs prevent orphaned keys/memberships (an isolation guarantee in itself), so
  // trigger a real violation on a non-FK field: a usage counter for a ghost org
  await db.usageCounter.create({ data: { orgId: "ENTTEST_ghost_org", day: "2099-01-01", count: 1, limit: 10 } });
  const iso2 = await verifyTenantIsolation();
  expect(iso2.violations).toBeGreaterThanOrEqual(1);
  expect(iso2.checks.find((c) => c.name === "usage_counters_per_org")!.ok).toBe(false);
});

// ---- Quotas ----
test("resource quota enforces the org policy against real usage", async () => {
  await setOrgPolicy("ENTTEST_org", { maxCompanies: 0 }); // zero allowance
  const q = await checkResourceQuota("ENTTEST_org", "companies");
  expect(q.ok).toBe(false);
  expect(q.reason).toContain("quota reached");
  const p = await getOrgPolicy("ENTTEST_org");
  expect(p.source).toBe("CONFIGURED");
  expect(p.maxCompanies).toBe(0);
});

// ---- Backups (never fabricated) ----
test("backup is UNCONFIGURED without storage — never a fabricated success", async () => {
  const r = await createBackup({ orgId: "ENTTEST_org" });
  expect(r.status).toBe("UNCONFIGURED");
  expect(r.note).toContain("never faked");
});

test("configured backup writes a REAL manifest of row counts", async () => {
  process.env.GENESIS_BACKUP_TARGET = "s3://enttest-bucket/backups";
  const r = await createBackup({ orgId: "ENTTEST_org" });
  expect(r.status).toBe("COMPLETED");
  const row = await db.backupRecord.findUnique({ where: { backupId: r.backupId } });
  const manifest = JSON.parse(row!.manifest) as Record<string, number>;
  expect(Object.keys(manifest).length).toBeGreaterThan(0);
  expect(row!.checksum).toBeTruthy();
  expect(row!.storageTarget).not.toContain("enttest-bucket"); // target is masked, not stored raw
  // restore
  const rest = await restoreBackup(r.backupId);
  expect(rest.ok).toBe(true);
  expect((await db.backupRecord.findUnique({ where: { backupId: r.backupId } }))!.status).toBe("RESTORED");
});

// ---- GDPR (approval-gated, real) ----
test("GDPR delete is APPROVAL-GATED and only runs real deletion after approval", async () => {
  await db.company.create({ data: { key: "ENTTEST_co", name: "Ent", mission: "m" } });
  await db.lead.create({ data: { leadId: "LEAD-ENTTEST1", subject: "ENTTEST_co", name: "x", source: "s", evidenceUrl: "https://x", dataLabel: "REAL" } });
  const req = await requestGdpr({ subjectType: "COMPANY", subjectKey: "ENTTEST_co", kind: "DELETE" });
  expect(req.approvalId).toMatch(/^APR-/);
  // cannot execute before approval
  expect((await executeGdpr(req.requestId)).ok).toBe(false);
  expect(await db.company.count({ where: { key: "ENTTEST_co" } })).toBe(1); // still there

  await decideGdpr(req.requestId, { approve: true, decidedBy: "operator" });
  const exec = await executeGdpr(req.requestId);
  expect(exec.ok).toBe(true);
  expect(exec.summary).toContain("DELETE COMPANY");
  expect(await db.company.count({ where: { key: "ENTTEST_co" } })).toBe(0); // really deleted
  expect(await db.lead.count({ where: { subject: "ENTTEST_co" } })).toBe(0);
});

test("GDPR export produces a real manifest without deleting", async () => {
  await db.company.create({ data: { key: "ENTTEST_co2", name: "E2", mission: "m" } });
  await db.lead.create({ data: { leadId: "LEAD-ENTTEST2", subject: "ENTTEST_co2", name: "y", source: "s", evidenceUrl: "https://y", dataLabel: "REAL" } });
  const req = await requestGdpr({ subjectType: "COMPANY", subjectKey: "ENTTEST_co2", kind: "EXPORT" });
  await decideGdpr(req.requestId, { approve: true, decidedBy: "op" });
  const exec = await executeGdpr(req.requestId);
  expect(exec.ok).toBe(true);
  expect(exec.summary).toContain("EXPORT");
  expect(await db.company.count({ where: { key: "ENTTEST_co2" } })).toBe(1); // export never deletes
});

test("rejected GDPR request never executes", async () => {
  await db.company.create({ data: { key: "ENTTEST_co3", name: "E3", mission: "m" } });
  const req = await requestGdpr({ subjectType: "COMPANY", subjectKey: "ENTTEST_co3", kind: "DELETE" });
  await decideGdpr(req.requestId, { approve: false, decidedBy: "op" });
  expect((await executeGdpr(req.requestId)).ok).toBe(false);
  expect(await db.company.count({ where: { key: "ENTTEST_co3" } })).toBe(1);
});

// ---- Compliance (verified controls only, no certification) ----
test("compliance report lists VERIFIED controls and NEVER claims certification", async () => {
  const soc2 = await complianceReport("SOC2");
  expect(soc2.framework).toBe("SOC2");
  expect(soc2.controls.every((c) => ["VERIFIED", "PARTIAL", "UNMET"].includes(c.status))).toBe(true);
  expect(soc2.controls.every((c) => c.evidence.length > 0)).toBe(true); // every control cites evidence
  expect(soc2.disclaimer).toContain("NOT a certification");
  // encryption unmet honestly reflected
  expect(soc2.controls.find((c) => c.id === "encryption_at_rest")!.status).toBe("UNMET");
  process.env.GENESIS_DB_ENCRYPTION_KEY = "test-key";
  const soc2b = await complianceReport("SOC2");
  expect(soc2b.controls.find((c) => c.id === "encryption_at_rest")!.status).toBe("VERIFIED");
  const gdpr = await complianceReport("GDPR");
  expect(gdpr.controls.some((c) => c.id === "right_to_erasure")).toBe(true);
});

// ---- Encryption readiness + key rotation ----
test("encryption readiness reports real posture; at-rest UNCONFIGURED by default", async () => {
  const e = await encryptionReadiness();
  expect(e.controls.find((c) => c.control === "api_keys_hashed_at_rest")!.status).toBe("VERIFIED");
  expect(e.controls.find((c) => c.control === "database_encryption_at_rest")!.status).toBe("UNCONFIGURED");
});

test("key rotation mints a new key and revokes the old", async () => {
  await makeOrg("ENTTEST_org");
  await db.authUser.create({ data: { userId: "ENTTEST_ru", email: "rot@test.co" } });
  const k = await createApiKey({ userId: "ENTTEST_ru", orgId: "ENTTEST_org", role: "ADMIN" });
  const rot = await rotateApiKey(k.keyId, OWNER);
  expect("newKeyId" in rot).toBe(true);
  if ("newKeyId" in rot) expect(rot.newKeyId).not.toBe(k.keyId);
  expect((await db.apiKey.findUnique({ where: { keyId: k.keyId } }))!.revokedAt).not.toBeNull(); // old revoked
  // rotating a revoked key fails
  expect("error" in (await rotateApiKey(k.keyId, OWNER))).toBe(true);
  const life = await secretLifecycle();
  expect(life.revoked).toBeGreaterThanOrEqual(1);
});

// ---- Health + audit export ----
test("enterprise health scores every area with a how-computed explanation", async () => {
  const h = await enterpriseHealth();
  const areas = ["Security", "Compliance", "Isolation", "Recovery", "Reliability", "Encryption"];
  for (const a of areas) { const s = h.areas.find((x) => x.area === a)!; expect(s).toBeDefined(); expect(s.howComputed.length).toBeGreaterThan(0); }
  expect(h.overall).toBeGreaterThanOrEqual(0);
  expect(h.overall).toBeLessThanOrEqual(100);
  // recovery is honestly low without backup storage
  expect(h.areas.find((a) => a.area === "Recovery")!.score).toBe(20);
});

test("audit export returns real audit entries", async () => {
  const ex = await exportAuditLog({ limit: 10 });
  expect(typeof ex.count).toBe("number");
  expect(Array.isArray(ex.entries)).toBe(true);
});
