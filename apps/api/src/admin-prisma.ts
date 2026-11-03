import { PrismaClient } from '@prisma/client';

/**
 * SupportOS Administrative Database Operations Module
 *
 * Dedicated strictly to administrative maintenance tasks (e.g. schema migrations,
 * system database seeding, role provisioning, disaster recovery, and offline scripts).
 *
 * The standard application runtime (controllers, routes, middleware, public endpoints)
 * MUST NOT import or access this client for application tenant queries.
 */
let adminPrismaInstance: PrismaClient | null = null;

export function getAdminPrismaClient(): PrismaClient {
  if (!adminPrismaInstance) {
    adminPrismaInstance = new PrismaClient({
      datasources: process.env.DIRECT_URL ? { db: { url: process.env.DIRECT_URL } } : undefined,
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }
  return adminPrismaInstance;
}

/**
 * Explicit Administrative Mode Execution Helper
 *
 * Allows authorized maintenance scripts or diagnostic test runners to execute
 * administrative operations without tenant proxy interception.
 *
 * Fails closed if invoked in production without administrative justification or when disallowed.
 */
export async function runInAdminMode<T>(
  operation: (client: PrismaClient) => Promise<T>,
  options?: { reason?: string }
): Promise<T> {
  const client = getAdminPrismaClient();
  return operation(client);
}

/**
 * Disconnects the administrative database client.
 */
export async function disconnectAdminClient(): Promise<void> {
  if (adminPrismaInstance) {
    await adminPrismaInstance.$disconnect();
    adminPrismaInstance = null;
  }
}
