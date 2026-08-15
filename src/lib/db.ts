import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import { env } from '@/env'

/**
 * Prisma 7 connects through a driver adapter rather than reading the URL from
 * the schema. A single client is cached on `globalThis` so Next.js hot reloads
 * don't exhaust the connection pool in development.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  })

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
