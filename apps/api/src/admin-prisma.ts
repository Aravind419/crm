import { PrismaClient } from '@prisma/client';
import { isHttpRequestActive } from './tenancy/http-request-context';
import { tenantStorage } from './tenancy/tenant-context';
import { isServerProcessActive } from './process-identity';

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
 * Requires dedicated maintenance credentials (DIRECT_URL).
 */
function getInternalAdminClient(): PrismaClient {
  if (!adminPrismaInstance) {
    const adminUrl = process.env.DIRECT_URL;
    const isPg = (process.env.DATABASE_URL || '').startsWith('postgres');

    if (isPg && !adminUrl) {
      throw new Error(
        '[Administrative Access Denied] Dedicated maintenance credentials (DIRECT_URL) are required for administrative operations.'
      );
    }

    if (adminUrl && adminUrl.includes('supportos_app')) {
      throw new Error(
        '[Administrative Access Denied] Dedicated maintenance credentials required. Unprivileged application role (supportos_app) cannot execute administrative operations.'
      );
    }

    const effectiveUrl = adminUrl || process.env.DATABASE_URL;
    adminPrismaInstance = new PrismaClient({
      datasources: effectiveUrl ? { db: { url: effectiveUrl } } : undefined,
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }
  return adminPrismaInstance;
}

/**
 * Explicit Administrative Mode Execution Helper
 *
 * Restricts administrative database access strictly to dedicated offline maintenance,
 * system seeding, and migration operations.
 *
 * Security Invariants Enforced:
 * 1. Prohibited within the HTTP server process, regardless of environment flags.
 * 2. Prohibited during any active HTTP request execution.
 * 3. Prohibited within any active tenant, agent, or visitor transaction context.
 * 4. Requires a valid, non-empty, descriptive administrative reason (>= 5 chars).
 * 5. Caller-provided flags/booleans are never accepted as authorization.
 * 6. Emits structured JSON audit events on initiation, success, and sanitized failure.
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

  // 2. Reject if invoked within an active tenant/agent/visitor context
  const activeTenantStore = tenantStorage?.getStore();
  if (activeTenantStore !== undefined) {
    throw new Error(
      `[Administrative Access Denied] Tenant request context (${activeTenantStore.actorType || 'TENANT'}) cannot execute administrative operations.`
    );
  }

  // 3. Reject if invoked within an active HTTP request context
  if (isHttpRequestActive()) {
    throw new Error(
      '[Administrative Access Denied] Administrative database access is strictly prohibited during HTTP request execution.'
    );
  }

  // 4. Reject if invoked within the normal HTTP application server process
  // The HTTP application process must NEVER execute administrative operations, regardless of env flags
  if (isServerProcessActive()) {
    throw new Error(
      '[Administrative Access Denied] Administrative database access is strictly prohibited within the HTTP server process, regardless of environment flags.'
    );
  }

  const sanitizedReason = options.reason.trim().replace(/[\r\n\t]/g, ' ');

  // Structured Audit Event: Initiation
  const startAudit = {
    eventType: 'ADMIN_MAINTENANCE_OPERATION_START',
    timestamp: new Date().toISOString(),
    reason: sanitizedReason,
    processId: process.pid,
    nodeEnv: process.env.NODE_ENV || 'development',
  };
  console.info(JSON.stringify(startAudit));

  try {
    const client = getInternalAdminClient();
    const result = await operation(client);

    // Structured Audit Event: Success
    const successAudit = {
      eventType: 'ADMIN_MAINTENANCE_OPERATION_SUCCESS',
      timestamp: new Date().toISOString(),
      reason: sanitizedReason,
      processId: process.pid,
      status: 'SUCCESS',
    };
    console.info(JSON.stringify(successAudit));

    return result;
  } catch (err: any) {
    const rawMsg = err?.message || String(err);
    const sanitizedError = sanitizeLogMessage(rawMsg);

    // Structured Audit Event: Failure (Redacting all database credentials)
    const failureAudit = {
      eventType: 'ADMIN_MAINTENANCE_OPERATION_FAILURE',
      timestamp: new Date().toISOString(),
      reason: sanitizedReason,
      processId: process.pid,
      error: sanitizedError,
      status: 'FAILED',
    };
    console.error(JSON.stringify(failureAudit));

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
