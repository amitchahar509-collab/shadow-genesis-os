/** Fine-grained RBAC (V10 Module 11) — a permission matrix layered OVER the
 *  existing auth Role (OWNER/ADMIN/MEMBER/VIEWER). This does not replace guard();
 *  it makes role→permission decisions explicit and testable. Pure logic, no I/O.
 */

import type { Role } from "../auth";

/** Fine-grained permissions across the system's real capability surface. */
export type Permission =
  | "read"                    // view dashboards/data
  | "write"                   // create/update non-destructive
  | "approve"                 // decide approval requests (human authority)
  | "execute_external"        // run approved external mutations (connectors/deploys)
  | "manage_members"          // add/remove org members, mint/rotate keys
  | "manage_policy"           // set org policy/quotas
  | "manage_backups"          // create/restore backups
  | "gdpr_admin"              // request data export/deletion
  | "delete_data";            // destructive deletion (highest bar)

const RANK: Record<Role, number> = { VIEWER: 1, MEMBER: 2, ADMIN: 3, OWNER: 4 };

/** Minimum role required for each permission. */
const MIN_ROLE: Record<Permission, Role> = {
  read: "VIEWER",
  write: "MEMBER",
  approve: "ADMIN",           // approvals are a human-authority action
  execute_external: "ADMIN",  // running a real external mutation is admin-gated
  manage_members: "ADMIN",
  manage_policy: "OWNER",     // policy/quota changes are owner-only
  manage_backups: "ADMIN",
  gdpr_admin: "OWNER",        // data export/erasure is owner-only
  delete_data: "OWNER",       // destructive deletion is the highest bar
};

/** Does a role hold a permission? */
export function can(role: Role, permission: Permission): boolean {
  return RANK[role] >= RANK[MIN_ROLE[permission]];
}

/** Every permission a role holds — for the RBAC dashboard. */
export function permissionsFor(role: Role): Permission[] {
  return (Object.keys(MIN_ROLE) as Permission[]).filter((p) => can(role, p));
}

/** The full role→permission matrix (explainable, for the Control Center). */
export function rbacMatrix(): { role: Role; permissions: Permission[] }[] {
  return (["OWNER", "ADMIN", "MEMBER", "VIEWER"] as Role[]).map((role) => ({ role, permissions: permissionsFor(role) }));
}

/** Assert a permission, returning a structured decision (for API gating). */
export function authorize(role: Role, permission: Permission): { allowed: boolean; reason: string } {
  const allowed = can(role, permission);
  return { allowed, reason: allowed ? `role ${role} holds "${permission}"` : `role ${role} lacks "${permission}" (needs ${MIN_ROLE[permission]})` };
}

export { MIN_ROLE };
