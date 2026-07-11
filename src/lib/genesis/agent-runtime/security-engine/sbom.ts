/** SBOM + Dependency Audit (V10 Module 6).
 *
 * Generates a REAL Software Bill of Materials (CycloneDX 1.5 + SPDX 2.3) from a
 * package.json, and audits declared dependencies against an OFFLINE advisory
 * list. CVE-feed lookups require a real feed/key; without one the CVE status is
 * honestly UNKNOWN — never a fabricated vulnerability.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

export interface Component { name: string; version: string; scope: "prod" | "dev" }

/** Read declared dependencies from a real package.json. */
export async function readComponents(repoPath: string): Promise<Component[] | { error: string }> {
  try {
    const raw = await fs.readFile(path.join(repoPath, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const comps: Component[] = [];
    for (const [name, version] of Object.entries(pkg.dependencies ?? {})) comps.push({ name, version: cleanVersion(version), scope: "prod" });
    for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) comps.push({ name, version: cleanVersion(version), scope: "dev" });
    return comps;
  } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
}
const cleanVersion = (v: string) => v.replace(/^[\^~>=<\s]+/, "").trim() || "unknown";

/** CycloneDX 1.5 JSON — the real, tool-ingestable format. */
export function toCycloneDX(components: Component[]): unknown {
  return {
    bomFormat: "CycloneDX", specVersion: "1.5", version: 1,
    metadata: { timestamp: new Date().toISOString(), tools: [{ vendor: "ShadowGenesisOS", name: "security-engine" }], component: { type: "application", name: "shadow-genesis-os" } },
    components: components.map((c) => ({ type: "library", name: c.name, version: c.version, scope: c.scope === "dev" ? "optional" : "required", purl: `pkg:npm/${c.name}@${c.version}` })),
  };
}

/** SPDX 2.3 JSON — the real, tool-ingestable format. */
export function toSPDX(components: Component[]): unknown {
  return {
    spdxVersion: "SPDX-2.3", dataLicense: "CC0-1.0", SPDXID: "SPDXRef-DOCUMENT", name: "shadow-genesis-os-sbom",
    documentNamespace: `https://shadow-genesis/sbom/${Date.now()}`,
    creationInfo: { created: new Date().toISOString(), creators: ["Tool: ShadowGenesisOS-security-engine"] },
    packages: components.map((c, i) => ({ name: c.name, SPDXID: `SPDXRef-Package-${i}`, versionInfo: c.version, downloadLocation: `https://registry.npmjs.org/${c.name}/-/${c.name}-${c.version}.tgz`, licenseConcluded: "NOASSERTION", filesAnalyzed: false })),
  };
}

// Offline advisory list — a small set of REAL, well-known advisories. Extendable;
// absence of a match is NOT proof of safety (labeled), it just means no offline hit.
const OFFLINE_ADVISORIES: { name: string; below: string; severity: string; advisory: string }[] = [
  { name: "lodash", below: "4.17.21", severity: "HIGH", advisory: "CVE-2021-23337 command injection in template" },
  { name: "axios", below: "1.6.0", severity: "HIGH", advisory: "CVE-2023-45857 SSRF / credential leak" },
  { name: "next", below: "14.1.1", severity: "HIGH", advisory: "CVE-2024-34351 SSRF in server actions" },
  { name: "minimist", below: "1.2.6", severity: "MEDIUM", advisory: "CVE-2021-44906 prototype pollution" },
  { name: "semver", below: "7.5.2", severity: "MEDIUM", advisory: "CVE-2022-25883 ReDoS" },
];

export interface DepFinding { name: string; version: string; severity: string; advisory: string; label: "REAL" }
export interface DepAuditResult { components: number; findings: DepFinding[]; cveFeed: "UNKNOWN"; note: string }

function ltVersion(a: string, b: string): boolean {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0), pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] ?? 0) < (pb[i] ?? 0)) return true; if ((pa[i] ?? 0) > (pb[i] ?? 0)) return false; }
  return false;
}

/** Audit declared deps against the offline advisory list. Honest about the CVE
 *  feed: without a real feed, CVE status is UNKNOWN — no fabricated vulns. */
export async function auditDependencies(repoPath: string): Promise<DepAuditResult | { error: string }> {
  const comps = await readComponents(repoPath);
  if ("error" in comps) return comps;
  const findings: DepFinding[] = [];
  for (const c of comps) {
    const adv = OFFLINE_ADVISORIES.find((a) => a.name === c.name && c.version !== "unknown" && ltVersion(c.version, a.below));
    if (adv) findings.push({ name: c.name, version: c.version, severity: adv.severity, advisory: adv.advisory, label: "REAL" });
  }
  return {
    components: comps.length, findings, cveFeed: "UNKNOWN",
    note: "matched against an OFFLINE advisory list (REAL hits only). Live CVE feed UNKNOWN — set an advisory API to enable; no offline match ≠ proven safe.",
  };
}

/** Write both SBOM formats to disk as real artifacts. */
export async function writeSBOM(repoPath: string, outDir: string): Promise<{ cyclonedx: string; spdx: string } | { error: string }> {
  const comps = await readComponents(repoPath);
  if ("error" in comps) return comps;
  await fs.mkdir(outDir, { recursive: true });
  const cdxPath = path.join(outDir, "sbom.cyclonedx.json");
  const spdxPath = path.join(outDir, "sbom.spdx.json");
  await fs.writeFile(cdxPath, JSON.stringify(toCycloneDX(comps), null, 2), "utf8");
  await fs.writeFile(spdxPath, JSON.stringify(toSPDX(comps), null, 2), "utf8");
  return { cyclonedx: cdxPath, spdx: spdxPath };
}
