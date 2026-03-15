import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';

// Allow BigInt to be serialised by JSON.stringify (used by Express res.json())
// This must run before any JSON.stringify call that encounters a BigInt value.
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: env.isDev() ? ['query', 'warn', 'error'] : ['error'],
  });

if (env.isDev()) {
  globalForPrisma.prisma = prisma;
}
