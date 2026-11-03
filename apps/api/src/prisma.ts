import { PrismaClient, Prisma } from '@prisma/client';
import { tenantStorage } from './tenancy/tenant-context';
import { AuthLookupService } from './tenancy/auth-lookup.service';
import { isServerProcessActive } from './process-identity';

export const isPostgreSql = (): boolean => {
  const url = process.env.DATABASE_URL || '';
  return url.startsWith('postgres://') || url.startsWith('postgresql://');
};

// Enforce credential separation: runtime DATABASE_URL must not match DIRECT_URL in production or in server process
if (
  (process.env.NODE_ENV === 'production' || isServerProcessActive()) &&
  process.env.DIRECT_URL &&
  process.env.DATABASE_URL &&
  process.env.DATABASE_URL.trim() === process.env.DIRECT_URL.trim()
) {
  throw new Error(
    '[Security Violation] Runtime DATABASE_URL must not match DIRECT_URL. Direct database connection credentials are reserved exclusively for dedicated maintenance processes.'
  );
}

/**
 * Underlying Prisma Client instance.
 * Kept private/internal to this module so the standard application runtime
 * cannot accidentally import or access an unscoped client.
 */
const rawPrisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

// Configure sensible default timeouts for interactive transactions over cloud/pooled databases
const defaultTxOptions = {
  maxWait: 10000,
  timeout: 25000,
};

const originalTransaction = rawPrisma.$transaction.bind(rawPrisma);
rawPrisma.$transaction = ((arg: any, options?: any) => {
  if (typeof arg === 'function') {
    return originalTransaction(arg, { ...defaultTxOptions, ...options });
  }
  return originalTransaction(arg, options);
}) as any;

/**
 * Internal transaction executor for tenant-context.ts.
 * Not exposed as a general database query interface.
 */
export const executeTenantTransaction = async <T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: any
): Promise<T> => {
  return rawPrisma.$transaction(fn, { ...defaultTxOptions, ...options });
};

const PERMITTED_READ_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

const PROHIBITED_WRITE_ARG_KEYS = new Set([
  'data',
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
  'connectOrCreate',
]);

function assertNoNestedWrites(obj: any): void {
  if (!obj || typeof obj !== 'object') return;
  for (const key of Object.keys(obj)) {
    if (PROHIBITED_WRITE_ARG_KEYS.has(key)) {
      throw new Error(
        `[Read-Only Lookup Violation] Mutating property "${key}" is strictly prohibited in read-only lookup arguments.`
      );
    }
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      assertNoNestedWrites(obj[key]);
    }
  }
}

/**
 * Read-only interface restricted strictly to authentication and pre-tenant resolution queries.
 * Wraps operations in a read-only guard proxy and enforces database read-only constraints.
 * Database write operations (create, update, delete, upsert, raw executions) strictly fail closed.
 */
export const executeReadOnlyLookup = async <T>(
  queryFn: (client: Prisma.TransactionClient) => Promise<T>
): Promise<T> => {
  return rawPrisma.$transaction(async (tx) => {
    if (isPostgreSql()) {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const settingRows = await tx.$queryRaw<Array<{ current_setting: string }>>`SELECT current_setting('transaction_read_only')`;
      if (!settingRows || settingRows.length === 0 || settingRows[0]?.current_setting !== 'on') {
        throw new Error(
          `[Read-Only Lookup Violation] Failed to verify PostgreSQL read-only transaction state. Expected "on", received "${settingRows?.[0]?.current_setting}".`
        );
      }
    }

    const readOnlyTx = new Proxy(tx, {
      get(target, prop, receiver) {
        if (prop === '$transaction') {
          throw new Error(
            '[Read-Only Lookup Violation] Nested or escaping transactions ($transaction) are prohibited in read-only lookups.'
          );
        }
        if (prop === '$connect' || prop === '$disconnect') {
          throw new Error(
            `[Read-Only Lookup Violation] Connection management (${String(prop)}) is prohibited in read-only lookups.`
          );
        }
        if (prop === '$executeRaw' || prop === '$executeRawUnsafe') {
          throw new Error(
            `[Read-Only Lookup Violation] Raw execution method "${String(prop)}" is prohibited in pre-auth lookup service.`
          );
        }
        if (prop === '$queryRawUnsafe') {
          throw new Error(
            '[Read-Only Lookup Violation] Raw unescaped queries ($queryRawUnsafe) are prohibited in pre-auth lookup service.'
          );
        }
        if (prop === '$queryRaw') {
          return async (stringsOrQuery: any, ...values: any[]) => {
            let sql = '';
            if (Array.isArray(stringsOrQuery)) {
              sql = stringsOrQuery.join(' ');
            } else if (typeof stringsOrQuery === 'string') {
              sql = stringsOrQuery;
            } else if (stringsOrQuery && typeof stringsOrQuery.sql === 'string') {
              sql = stringsOrQuery.sql;
            } else if (stringsOrQuery && Array.isArray(stringsOrQuery.strings)) {
              sql = stringsOrQuery.strings.join(' ');
            }
            const cleanSql = sql.trim().toUpperCase();
            const prohibitedKeywords = [
              'INSERT',
              'UPDATE',
              'DELETE',
              'DROP',
              'ALTER',
              'TRUNCATE',
              'CREATE',
              'REPLACE',
              'GRANT',
              'REVOKE',
              'VACUUM',
              'ATTACH',
              'DETACH',
            ];
            for (const kw of prohibitedKeywords) {
              const regex = new RegExp(`\\b${kw}\\b`, 'i');
              if (regex.test(cleanSql)) {
                throw new Error(
                  `[Read-Only Lookup Violation] Raw query contains prohibited mutating statement "${kw}".`
                );
              }
            }
            if (!/^(SELECT|SHOW|WITH|EXPLAIN)\b/i.test(cleanSql)) {
              throw new Error(
                `[Read-Only Lookup Violation] Raw query is not an authorized read-only statement.`
              );
            }
            return (target as any).$queryRaw(stringsOrQuery, ...values);
          };
        }

        const val = (target as any)[prop];
        if (typeof val === 'object' && val !== null) {
          return new Proxy(val, {
            get(modelTarget, methodProp) {
              if (!PERMITTED_READ_OPERATIONS.has(String(methodProp))) {
                throw new Error(
                  `[Read-Only Lookup Violation] Database operation "${String(methodProp)}" is strictly prohibited in authentication lookup service. Permitted operations are: ${Array.from(PERMITTED_READ_OPERATIONS).join(', ')}.`
                );
              }
              const method = modelTarget[methodProp];
              if (typeof method !== 'function') return method;
              return async (...args: any[]) => {
                for (const arg of args) {
                  assertNoNestedWrites(arg);
                }
                return method.apply(modelTarget, args);
              };
            },
          });
        }
        return typeof val === 'function' ? val.bind(target) : val;
      },
    });

    return queryFn(readOnlyTx as any);
  }, { timeout: 10000 });
};

const TENANT_MODELS = new Set([
  'organization',
  'workspace',
  'user',
  'team',
  'teamMember',
  'inbox',
  'customer',
  'conversation',
  'message',
  'attachment',
  'ticket',
  'ticketComment',
  'category',
  'article',
  'automationRule',
  'auditEvent',
  'refreshToken',
  'webhookEvent',
  'visitorSession',
]);

const MODEL_TO_TABLE: Record<string, string> = {
  organization: 'organizations',
  workspace: 'workspaces',
  user: 'users',
  team: 'teams',
  teamMember: 'team_members',
  inbox: 'inboxes',
  customer: 'customers',
  conversation: 'conversations',
  message: 'messages',
  attachment: 'attachments',
  ticket: 'tickets',
  ticketComment: 'ticket_comments',
  category: 'categories',
  article: 'articles',
  automationRule: 'automation_rules',
  auditEvent: 'audit_events',
  refreshToken: 'refresh_tokens',
  webhookEvent: 'webhook_events',
  visitorSession: 'visitor_sessions',
};

/**
 * Enterprise RLS-Aware Prisma Proxy
 *
 * Guarantees:
 * 1. Automatic Transaction Scoping: Any database access executed within runInTenantContext(...)
 *    is automatically routed through the transaction client (where app.current_organization_id is established).
 * 2. Unscoped Access Prevention: Direct access to any tenant-owned model without an active
 *    transaction-local tenant context is immediately rejected in production.
 * 3. Transparent Test Scoping: Explicitly scoped operations with resolvable orgId are wrapped
 *    in runInTenantContext automatically across BOTH PostgreSQL and SQLite.
 * 4. Strict Fail-Closed: Queries lacking an explicit, resolvable organization scope fail closed
 *    with [Tenant Isolation Violation] across ALL environments. ALLOW_UNSCOPED_ADMIN_QUERIES cannot bypass this.
 * 5. Nested Transaction Flattening: Calling prisma.$transaction(...) inside an existing tenant transaction
 *    transparently reuses the active transaction rather than creating an unsafe detached connection.
 */
export const prisma = new Proxy(rawPrisma, {
  get(target, prop, receiver) {
    const store = tenantStorage?.getStore();

    // 1. Intercept $transaction when already inside an active tenant transaction
    if (prop === '$transaction') {
      if (store && store.tx) {
        return async (arg: any) => {
          if (typeof arg === 'function') {
            return arg(store.tx);
          }
          if (Array.isArray(arg)) {
            return Promise.all(arg);
          }
          return arg;
        };
      }
      return (target as any).$transaction;
    }

    // 2. Route raw queries through active transaction if present
    if (prop === '$queryRaw' || prop === '$executeRaw' || prop === '$queryRawUnsafe' || prop === '$executeRawUnsafe') {
      if (store && store.tx) {
        const txMethod = (store.tx as any)[prop];
        if (typeof txMethod === 'function') {
          return txMethod.bind(store.tx);
        }
      }
      return (target as any)[prop];
    }

    // 3. If currently within an active tenant transaction context:
    if (store && store.tx) {
      const tx = store.tx as any;
      if (prop in tx) {
        const val = tx[prop];
        return typeof val === 'function' ? val.bind(tx) : val;
      }
    }

    // 4. If attempting to access a tenant-owned model without active tenant context:
    if (TENANT_MODELS.has(String(prop))) {
      // PRODUCTION SECURITY GATE:
      // In production, ALL access to tenant-owned models MUST execute within an explicit transaction-local tenant context (runInTenantContext).
      // Any attempt to execute an unscoped query against tenant data in production fails closed immediately.
      // Environment flags (such as ALLOW_UNSCOPED_ADMIN_QUERIES) and provider fallbacks are strictly rejected in production.
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          `[Tenant Isolation Violation] Unscoped access to tenant-owned model "${String(prop)}" is strictly prohibited in production. All tenant data queries must execute within an active transaction-local tenant context (runInTenantContext).`
        );
      }

      // NON-PRODUCTION HARNESS (Tests / CLI):
      // If an explicit organization context can be unambiguously resolved from query parameters,
      // wrap the operation in a transaction-local tenant context automatically for test harness convenience.
      // This applies to BOTH PostgreSQL and SQLite. Unresolved or unscoped queries fail closed immediately.
      const modelTarget = (rawPrisma as any)[prop];
      return new Proxy(modelTarget, {
        get(targetMethod, methodProp) {
          const originalMethod = targetMethod[methodProp];
          if (typeof originalMethod !== 'function') return originalMethod;
          return async (...args: any[]) => {
            const queryArgs = args[0] || {};
            let orgId: string | undefined =
              queryArgs?.where?.organizationId ||
              (String(prop) === 'organization'
                ? (typeof queryArgs?.where?.id === 'string'
                    ? queryArgs.where.id
                    : (Array.isArray(queryArgs?.where?.id?.in) ? queryArgs.where.id.in[0] : undefined))
                : undefined) ||
              queryArgs?.data?.organizationId ||
              (String(prop) === 'organization'
                ? (typeof queryArgs?.data?.id === 'string' ? queryArgs.data.id : undefined)
                : undefined);

            // Resolve orgId via helper if organization queried by slug
            if (!orgId && String(prop) === 'organization' && queryArgs?.where?.slug) {
              const o = await AuthLookupService.lookupOrgBySlug(queryArgs.where.slug);
              if (o) orgId = o.id;
            }

            // Resolve orgId via helper if user queried by email
            if (!orgId && String(prop) === 'user' && queryArgs?.where?.email) {
              const u = await AuthLookupService.lookupUserByEmail(queryArgs.where.email);
              if (u) orgId = u.organizationId;
            }

            // Resolve orgId via helper if user queried by invitationTokenHash
            if (!orgId && String(prop) === 'user' && queryArgs?.where?.invitationTokenHash) {
              const inv = await AuthLookupService.lookupUserByInvitation(queryArgs.where.invitationTokenHash);
              if (inv) orgId = inv.organizationId;
            }

            // Resolve orgId via helper if inbox queried by inboxKey
            if (!orgId && String(prop) === 'inbox' && queryArgs?.where?.inboxKey) {
              const ib = await AuthLookupService.lookupInboxByKey(queryArgs.where.inboxKey);
              if (ib) orgId = ib.organizationId;
            }

            // Resolve orgId via helper if visitor session queried by tokenHash
            if (!orgId && String(prop) === 'visitorSession' && queryArgs?.where?.tokenHash) {
              const vs = await AuthLookupService.lookupVisitorSession(queryArgs.where.tokenHash);
              if (vs) orgId = vs.organizationId;
            }

            // Resolve orgId via helper if refresh token queried by tokenHash
            if (!orgId && String(prop) === 'refreshToken' && queryArgs?.where?.tokenHash) {
              const rt = await AuthLookupService.lookupRefreshToken(queryArgs.where.tokenHash);
              if (rt) orgId = rt.organizationId;
            }

            // Resolve orgId by record ID if where.id is supplied
            if (!orgId && queryArgs?.where?.id) {
              const idVal = typeof queryArgs.where.id === 'string'
                ? queryArgs.where.id
                : (Array.isArray(queryArgs.where.id?.in) ? queryArgs.where.id.in[0] : null);
              const tableName = MODEL_TO_TABLE[String(prop)];
              if (tableName && idVal) {
                const resolved = await AuthLookupService.lookupOrgByRecord(tableName, idVal);
                if (resolved) orgId = resolved;
              }
            }

            // Resolve orgId if where.userId is supplied
            if (!orgId && queryArgs?.where?.userId) {
              const uId = typeof queryArgs.where.userId === 'string'
                ? queryArgs.where.userId
                : (Array.isArray(queryArgs.where.userId?.in) ? queryArgs.where.userId.in[0] : null);
              if (uId) {
                const resolved = await AuthLookupService.lookupOrgByRecord('users', uId);
                if (resolved) orgId = resolved;
              }
            }

            // Resolve orgId if where.entityId is supplied (e.g. auditEvent)
            if (!orgId && queryArgs?.where?.entityId && typeof queryArgs.where.entityId === 'string') {
              const resolved = await AuthLookupService.lookupOrgByRecord('audit_events', queryArgs.where.entityId)
                || await AuthLookupService.lookupOrgByRecord('organizations', queryArgs.where.entityId)
                || await AuthLookupService.lookupOrgByRecord('users', queryArgs.where.entityId);
              if (resolved) orgId = resolved;
            }

            // Resolve orgId if where.eventId is supplied (e.g. webhookEvent)
            if (!orgId && queryArgs?.where?.eventId) {
              const eId = typeof queryArgs.where.eventId === 'string'
                ? queryArgs.where.eventId
                : (Array.isArray(queryArgs.where.eventId?.in) ? queryArgs.where.eventId.in[0] : null);
              if (eId) {
                const resolved = await AuthLookupService.lookupOrgByRecord('webhook_events', eId);
                if (resolved) orgId = resolved;
              }
            }

            // Resolve orgId if where.inboxId is supplied
            if (!orgId && queryArgs?.where?.inboxId) {
              const ibId = typeof queryArgs.where.inboxId === 'string'
                ? queryArgs.where.inboxId
                : (Array.isArray(queryArgs.where.inboxId?.in) ? queryArgs.where.inboxId.in[0] : null);
              if (ibId) {
                const resolved = await AuthLookupService.lookupOrgByRecord('inboxes', ibId);
                if (resolved) orgId = resolved;
              }
            }

            // Resolve orgId if where.customerId is supplied
            if (!orgId && queryArgs?.where?.customerId) {
              const cId = typeof queryArgs.where.customerId === 'string'
                ? queryArgs.where.customerId
                : (Array.isArray(queryArgs.where.customerId?.in) ? queryArgs.where.customerId.in[0] : null);
              if (cId) {
                const resolved = await AuthLookupService.lookupOrgByRecord('customers', cId);
                if (resolved) orgId = resolved;
              }
            }

            // Resolve orgId if where.conversationId is supplied
            if (!orgId && queryArgs?.where?.conversationId) {
              const cvId = typeof queryArgs.where.conversationId === 'string'
                ? queryArgs.where.conversationId
                : (Array.isArray(queryArgs.where.conversationId?.in) ? queryArgs.where.conversationId.in[0] : null);
              if (cvId) {
                const resolved = await AuthLookupService.lookupOrgByRecord('conversations', cvId);
                if (resolved) orgId = resolved;
              }
            }

            // Resolve orgId by inboxId in data (e.g. visitorSession.create)
            if (!orgId && queryArgs?.data?.inboxId && typeof queryArgs.data.inboxId === 'string') {
              const resolved = await AuthLookupService.lookupOrgByRecord('inboxes', queryArgs.data.inboxId);
              if (resolved) orgId = resolved;
            }

            // Resolve orgId by userId in data (e.g. refreshToken.create)
            if (!orgId && queryArgs?.data?.userId && typeof queryArgs.data.userId === 'string') {
              const resolved = await AuthLookupService.lookupOrgByRecord('users', queryArgs.data.userId);
              if (resolved) orgId = resolved;
            }

            // If an authorized organization ID is resolved, execute inside runInTenantContext
            // (Works consistently across BOTH PostgreSQL and SQLite)
            if (orgId && typeof orgId === 'string') {
              const { runInTenantContext } = await import('./tenancy/tenant-context');
              return runInTenantContext(orgId, async (tx) => {
                return (tx as any)[prop][methodProp](...args);
              });
            }

            // FAIL CLOSED: Unscoped access to tenant-owned models without an explicit authorized organization scope is strictly prohibited
            throw new Error(
              `[Tenant Isolation Violation] Unscoped access to tenant-owned model "${String(prop)}" is prohibited. All tenant data queries must execute within an active transaction-local tenant context (runInTenantContext) or provide an explicit, resolvable organization scope.`
            );
          };
        },
      });
    }

    const val = (target as any)[prop];
    return typeof val === 'function' ? val.bind(target) : val;
  },
}) as unknown as PrismaClient;

export default prisma;
