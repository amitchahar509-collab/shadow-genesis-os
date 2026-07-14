/** Multi-Level Cache (V10 Module 12) — L1 in-process LRU + L2 persistent (DB).
 *
 * Caches ONLY deterministic computed outputs. Forbidden namespaces (approval,
 * security, external mutations, payments) are refused at the API — those must
 * never be cached. Hit/miss stats are REAL counters; the cold-vs-warm speedup is
 * measured, never fabricated.
 */

import { createHash } from "node:crypto";
import { db } from "@/lib/db";

const FORBIDDEN = /^(approval|security|payment|external|mutation|secret|connector)/i;

export function cacheKey(namespace: string, input: unknown): string {
  const hash = createHash("sha256").update(typeof input === "string" ? input : JSON.stringify(input)).digest("hex").slice(0, 24);
  return `${namespace}:${hash}`;
}

// ---- L1: in-process LRU (bounded) ----
interface L1Entry { value: unknown; expiresAt: number | null }
const L1_MAX = 500;
const l1 = new Map<string, L1Entry>();
const stats = { l1Hits: 0, l2Hits: 0, misses: 0, sets: 0, evictions: 0 };

function l1Get(key: string): L1Entry | undefined {
  const e = l1.get(key);
  if (!e) return undefined;
  if (e.expiresAt !== null && e.expiresAt < Date.now()) { l1.delete(key); return undefined; }
  // LRU touch: re-insert to move to the end
  l1.delete(key); l1.set(key, e);
  return e;
}
function l1Set(key: string, value: unknown, expiresAt: number | null) {
  if (l1.size >= L1_MAX && !l1.has(key)) { const oldest = l1.keys().next().value; if (oldest !== undefined) { l1.delete(oldest); stats.evictions++; } }
  l1.set(key, { value, expiresAt });
}

export function isCacheable(namespace: string): boolean { return !FORBIDDEN.test(namespace); }

/** Get from L1 → L2. Returns { value, level } or null on miss. */
export async function cacheGet<T = unknown>(namespace: string, input: unknown): Promise<{ value: T; level: "L1" | "L2" } | null> {
  const key = cacheKey(namespace, input);
  const hit = l1Get(key);
  if (hit) { stats.l1Hits++; return { value: hit.value as T, level: "L1" }; }
  const row = await db.cacheEntry.findUnique({ where: { cacheKey: key } });
  if (row && (!row.expiresAt || row.expiresAt > new Date())) {
    stats.l2Hits++;
    await db.cacheEntry.update({ where: { cacheKey: key }, data: { hits: { increment: 1 }, lastHitAt: new Date() } }).catch(() => {});
    const value = JSON.parse(row.value) as T;
    l1Set(key, value, row.expiresAt ? row.expiresAt.getTime() : null); // promote to L1
    return { value, level: "L2" };
  }
  stats.misses++;
  return null;
}

/** Set into both tiers. Refuses forbidden namespaces (returns false). */
export async function cacheSet(namespace: string, input: unknown, value: unknown, opts?: { ttlMs?: number; tags?: string[] }): Promise<boolean> {
  if (!isCacheable(namespace)) return false; // never cache approval/security/external/payment
  const key = cacheKey(namespace, input);
  const expiresAt = opts?.ttlMs ? Date.now() + opts.ttlMs : null;
  l1Set(key, value, expiresAt);
  const serialized = JSON.stringify(value);
  await db.cacheEntry.upsert({
    where: { cacheKey: key },
    create: { cacheKey: key, namespace, value: serialized, tags: JSON.stringify(opts?.tags ?? []), sizeBytes: serialized.length, expiresAt: expiresAt ? new Date(expiresAt) : null },
    update: { value: serialized, tags: JSON.stringify(opts?.tags ?? []), sizeBytes: serialized.length, expiresAt: expiresAt ? new Date(expiresAt) : null },
  }).catch(() => {});
  stats.sets++;
  return true;
}

/** Get-or-compute: returns cached value or runs fn(), caches it, and returns it.
 *  Only caches when the namespace is cacheable. */
export async function cached<T>(namespace: string, input: unknown, fn: () => Promise<T> | T, opts?: { ttlMs?: number; tags?: string[] }): Promise<{ value: T; cached: boolean; level?: "L1" | "L2" }> {
  const hit = await cacheGet<T>(namespace, input);
  if (hit) return { value: hit.value, cached: true, level: hit.level };
  const value = await fn();
  await cacheSet(namespace, input, value, opts);
  return { value, cached: false };
}

// ---- invalidation ----
export async function invalidate(namespace: string, input: unknown): Promise<void> {
  const key = cacheKey(namespace, input);
  l1.delete(key);
  await db.cacheEntry.deleteMany({ where: { cacheKey: key } }).catch(() => {});
}
export async function invalidateNamespace(namespace: string): Promise<number> {
  for (const k of [...l1.keys()]) if (k.startsWith(`${namespace}:`)) l1.delete(k);
  const r = await db.cacheEntry.deleteMany({ where: { namespace } }).catch(() => ({ count: 0 }));
  return r.count;
}
export async function invalidateByTag(tag: string): Promise<number> {
  const rows = await db.cacheEntry.findMany({ where: { tags: { contains: `"${tag}"` } }, select: { cacheKey: true } });
  for (const r of rows) l1.delete(r.cacheKey);
  const del = await db.cacheEntry.deleteMany({ where: { tags: { contains: `"${tag}"` } } }).catch(() => ({ count: 0 }));
  return del.count;
}
/** Sweep expired L2 entries. Returns how many were purged. */
export async function pruneExpired(): Promise<number> {
  const r = await db.cacheEntry.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => ({ count: 0 }));
  return r.count;
}

export function cacheStats() {
  const total = stats.l1Hits + stats.l2Hits + stats.misses;
  return {
    ...stats, l1Size: l1.size,
    hitRatio: total > 0 ? Math.round(((stats.l1Hits + stats.l2Hits) / total) * 100) / 100 : 0,
    lookups: total,
  };
}
export function resetCacheStats() { stats.l1Hits = 0; stats.l2Hits = 0; stats.misses = 0; stats.sets = 0; stats.evictions = 0; }
/** Test/hygiene: clear the L1 tier (does not touch L2). */
export function clearL1() { l1.clear(); }
