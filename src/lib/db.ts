import { PrismaClient } from '@prisma/client'
import * as path from 'node:path'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Resolve a STABLE absolute SQLite path.
 *
 * DATABASE_URL is a relative `file:../db/custom.db`, which Prisma resolves
 * against the schema's directory at RUNTIME. The production standalone server
 * runs from `<root>/.next/standalone`, so it silently opened a *second*
 * database at `<root>/.next/standalone/db/custom.db` — a build-output path that
 * `next build` wipes, destroying every mission/deployment row the production
 * server ever wrote (and leaving dev and prod on different data).
 *
 * Anchor the file to the real project root so dev and prod share one database
 * that survives rebuilds. Absolute URLs and non-SQLite URLs are left untouched.
 */
function stableDbUrl(): string | undefined {
  const raw = process.env.DATABASE_URL
  if (!raw?.startsWith('file:')) return raw // non-sqlite / unset → leave as-is
  const rel = raw.slice('file:'.length)
  if (path.isAbsolute(rel)) return raw
  let base = process.cwd()
  const marker = path.join('.next', 'standalone')
  if (base.endsWith(marker)) base = path.resolve(base, '..', '..')
  // the URL is relative to the schema dir (<root>/prisma)
  return 'file:' + path.resolve(base, 'prisma', rel)
}

// Query-level logging floods stdout on every DB call. Under concurrent load the
// synchronous stdout writes (amplified when piped through `tee`) block the event
// loop and wedge the server. Keep verbose query logs for local dev only; in
// production log just errors so concurrent requests stay non-blocking.
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: stableDbUrl() } },
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['query', 'error', 'warn'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
