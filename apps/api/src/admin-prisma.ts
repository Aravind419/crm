import { PrismaClient } from '@prisma/client';
import { isHttpRequestActive } from './tenancy/http-request-context';
import { tenantStorage } from './tenancy/tenant-context';

export interface AdminOperationOptions {
  /**
   * Mandatory descriptive rationale explaining the administrative maintenance task.
   * Must contain at least 5 characters.
   */
  reason: string;
}

let adminPrismaInstance: PrismaClient | null = null;

/**
 * Sanitizes log messages and error text by redacting embedded database credentials and URLs.
 */
export function sanitizeLogMessage(message: string): string {
  if (!message || typeof message !== 'string') return '';
  return message.replace(/(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@)/gi, '$1***$3');
}

/**
 * Internal administrative client instance.
 * Strictly NOT exported to ordinary application runtime code.
 */
function getInternalAdminClient(): PrismaClient {
  if (!adminPrismaInstance) {
    const adminUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
    adminPrismaInstance = new PrismaClient({
      datasources: adminUrl ? { db: { url: adminUrl } } : undefined,
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }
  return adminPrismaInstance;
}

/**
 * Explicit Administrative Mode Execution Helper
 *
 * Restricts administrative database access strictly to approved offline maintenance,
 * system seeding, and migration operations.
 *
 * Security Invariants Enforced:
 * 1. Prohibited during any active HTTP request execution.
 * 2. Prohibited within any active tenant, agent, or visitor transaction context.
 * 3. Requires a valid, non-empty, descriptive administrative reason (>= 5 chars).
 * 4. Caller-provided flags/booleans are never accepted as authorization.
 * 5. In production, administrative operations within the server process are disabled;
 *    administrative scripts must run as separate CLI processes with dedicated credentials.
 * 6. Audit logs execution reason and sanitized error messages without credential leakage.
 */
export async function runInAdminMode<T>(
  operation: (client: PrismaClient) => Promise<T>,
  options: AdminOperationOptions
): Promise<T> {
  // 1. Mandatory administrative reason validation
  if (!options || typeof options.reason !== 'string' || options.reason.trim().length < 5) {
    throw new Error(
      '[Administrative Access Denied] A descriptive reason (minimum 5 characters) is required for administrative operations.'
    );
  }

  // 2. Reject if invoked within an active HTTP request context
  if (isHttpRequestActive()) {
    throw new Error(
      '[Administrative Access Denied] Administrative database access is strictly prohibited during HTTP request execution.'
    );
  }

  // 3. Reject if invoked within an active tenant/agent/visitor context
  const activeTenantStore = tenantStorage?.getStore();
  if (activeTenantStore !== undefined) {
    throw new Error(
      `[Administrative Access Denied] Tenant request context (${activeTenantStore.actorType || 'TENANT'}) cannot execute administrative operations.`
    );
  }

  // 4. In production, prevent the HTTP application server from executing in-process administrative tasks
  // Administrative tasks in production must run as dedicated maintenance processes (e.g. scripts/provision-roles.ts, migrations)
  if (process.env.NODE_ENV === 'production' && process.env.SUPPORTOS_MAINTENANCE_PROCESS !== 'true') {
    throw new Error(
      '[Administrative Access Denied] In-process administrative operations are prohibited in production server. Run administrative scripts in a dedicated maintenance process.'
    );
  }

  const sanitizedReason = options.reason.trim().replace(/[\r\n\t]/g, ' ');
  console.info(`[ADMIN AUDIT] Executing administrative maintenance: "${sanitizedReason}" | Timestamp: ${new Date().toISOString()}`);

  try {
    const client = getInternalAdminClient();
    return await operation(client);
  } catch (err: any) {
    const rawMsg = err?.message || String(err);
    const sanitizedError = sanitizeLogMessage(rawMsg);
    console.error(`[ADMIN AUDIT ERROR] Administrative operation failed for "${sanitizedReason}": ${sanitizedError}`);
    if (err && typeof err === 'object') {
      err.message = sanitizedError;
    }
    throw err;
  }
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
