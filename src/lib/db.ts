import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Query-level logging floods stdout on every DB call. Under concurrent load the
// synchronous stdout writes (amplified when piped through `tee`) block the event
// loop and wedge the server. Keep verbose query logs for local dev only; in
// production log just errors so concurrent requests stay non-blocking.
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['query', 'error', 'warn'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db