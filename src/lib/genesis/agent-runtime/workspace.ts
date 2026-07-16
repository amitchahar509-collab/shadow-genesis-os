/** Durable root for everything agents generate (apps, repos, reports, artifacts).
 *
 * The production standalone server runs with cwd = `<project>/.next/standalone`,
 * so anchoring generated output to cwd buried it inside the build output — which
 * `next build` wipes on the next rebuild, silently destroying users' generated
 * apps and hiding them from view. Resolve a stable location instead:
 *   1. GENESIS_WORKSPACE_ROOT if set (operator override), else
 *   2. the real project root — strip a trailing `.next/standalone` from cwd so
 *      dev and prod agree and output survives rebuilds.
 *
 * This is a zero-dependency leaf module so any part of the runtime can import it
 * without risking an import cycle.
 */
import * as path from "node:path";

export function workspaceRoot(): string {
  const override = process.env.GENESIS_WORKSPACE_ROOT?.trim();
  if (override) return path.resolve(override);
  let base = process.cwd();
  const marker = path.join(".next", "standalone");
  if (base.endsWith(marker)) base = path.resolve(base, "..", "..");
  return path.join(base, ".genesis-workspace");
}
