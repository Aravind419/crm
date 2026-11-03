import { AsyncLocalStorage } from 'async_hooks';
import { Prisma } from '@prisma/client';
import { executeTenantTransaction, isPostgreSql } from '../prisma';

export interface TenantContextStore {
  organizationId: string;
  tx: Prisma.TransactionClient;
  actorId?: string;
  actorType?: 'AGENT' | 'VISITOR' | 'SYSTEM' | 'WORKER';
}

export const tenantStorage = new AsyncLocalStorage<TenantContextStore>();

/**
 * Returns current tenant context if within an active tenant transaction, or undefined.
 */
export function getTenantStore(): TenantContextStore | undefined {
  return tenantStorage.getStore();
}

/**
 * Returns current tenant context, or throws an isolation violation error if unscoped.
 */
export function requireTenantStore(): TenantContextStore {
  const store = tenantStorage.getStore();
  if (!store || !store.organizationId) {
    throw new Error(
      'Tenant Isolation Violation: Active transaction-local tenant context is required but none was found.'
    );
  }
  return store;
}

/**
 * Executes an operation within an explicit PostgreSQL interactive transaction where
 * app.current_organization_id is established locally via parameterized set_config(..., true).
 *
 * Guarantees:
 * - All queries inside fn execute on the EXACT SAME physical connection.
 * - app.current_organization_id is strictly local to the transaction and automatically vanishes upon commit/rollback.
 * - Nested calls for the same organization automatically reuse the existing active transaction client.
 * - Cross-tenant context switches within an active transaction are strictly rejected.
 */
export async function runInTenantContext<T>(
  organizationId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  metadata?: { actorId?: string; actorType?: 'AGENT' | 'VISITOR' | 'SYSTEM' | 'WORKER' }
): Promise<T> {
  if (!organizationId || typeof organizationId !== 'string' || !organizationId.trim()) {
    throw new Error('Tenant context error: A valid organizationId is required to establish tenant context.');
  }

  const trimmedOrgId = organizationId.trim();
  const currentStore = tenantStorage.getStore();

  // If already inside an active transaction for the SAME organization, reuse it (nested operation)
  if (currentStore && currentStore.organizationId === trimmedOrgId) {
    return fn(currentStore.tx);
  }

  // If inside an active transaction for a DIFFERENT organization, fail closed (prevent cross-tenant leak)
  if (currentStore && currentStore.organizationId !== trimmedOrgId) {
    throw new Error(
      `Tenant Security Violation: Cross-tenant context switch from ${currentStore.organizationId} to ${trimmedOrgId} inside an active transaction is strictly prohibited.`
    );
  }

  // Interactive transaction establishes transaction-local PostgreSQL RLS context
  return executeTenantTransaction(async (tx) => {
    if (isPostgreSql()) {
      // Execute parameterized SET LOCAL via set_config(..., is_local=true)
      // This strictly scopes app.current_organization_id to THIS transaction connection only.
      await tx.$executeRaw`SELECT set_config('app.current_organization_id', ${trimmedOrgId}, true)`;
    }

    const newStore: TenantContextStore = {
      organizationId: trimmedOrgId,
      tx,
      actorId: metadata?.actorId,
      actorType: metadata?.actorType || 'SYSTEM',
    };

    return tenantStorage.run(newStore, () => fn(tx));
  });
}
