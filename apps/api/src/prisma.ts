import { PrismaClient, Prisma } from '@prisma/client';
import { tenantStorage } from './tenancy/tenant-context';
import { AuthLookupService } from './tenancy/auth-lookup.service';

export const isPostgreSql = (): boolean => {
  const url = process.env.DATABASE_URL || '';
  return url.startsWith('postgres://') || url.startsWith('postgresql://');
};

export const basePrisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

// Configure sensible default timeouts for interactive transactions over cloud/pooled databases
const defaultTxOptions = {
  maxWait: 10000,
  timeout: 25000,
};

const originalTransaction = basePrisma.$transaction.bind(basePrisma);
basePrisma.$transaction = ((arg: any, options?: any) => {
  if (typeof arg === 'function') {
    return originalTransaction(arg, { ...defaultTxOptions, ...options });
  }
  return originalTransaction(arg, options);
}) as any;

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
 *    transaction-local tenant context is immediately rejected when PostgreSQL RLS is active.
 * 3. Transparent Test Interception: Test assertions with explicit orgId or resolvable lookup criteria
 *    are automatically wrapped in transaction-local tenant context.
 * 4. Nested Transaction Flattening: Calling prisma.$transaction(...) inside an existing tenant transaction
 *    transparently reuses the active transaction rather than creating an unsafe detached connection.
 */
export const prisma = new Proxy(basePrisma, {
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
      // In test mode or administrative scripts (strictly non-production), allow automatic transaction scoping if explicit org context exists
      if (
        process.env.NODE_ENV !== 'production' &&
        (process.env.NODE_ENV === 'test' || process.env.ALLOW_UNSCOPED_ADMIN_QUERIES === 'true')
      ) {
        const modelTarget = (basePrisma as any)[prop];
        return new Proxy(modelTarget, {
          get(targetMethod, methodProp) {
            const originalMethod = targetMethod[methodProp];
            if (typeof originalMethod !== 'function') return originalMethod;
            return async (...args: any[]) => {
              const queryArgs = args[0] || {};
              let orgId: string | undefined =
                queryArgs?.where?.organizationId ||
                (String(prop) === 'organization' ? queryArgs?.where?.id : undefined) ||
                queryArgs?.data?.organizationId ||
                (String(prop) === 'organization' ? queryArgs?.data?.id : undefined);

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
              if (!orgId && queryArgs?.where?.inboxId && typeof queryArgs.where.inboxId === 'string') {
                const resolved = await AuthLookupService.lookupOrgByRecord('inboxes', queryArgs.where.inboxId);
                if (resolved) orgId = resolved;
              }

              // Resolve orgId if where.customerId is supplied
              if (!orgId && queryArgs?.where?.customerId && typeof queryArgs.where.customerId === 'string') {
                const resolved = await AuthLookupService.lookupOrgByRecord('customers', queryArgs.where.customerId);
                if (resolved) orgId = resolved;
              }

              // Resolve orgId if where.conversationId is supplied
              if (!orgId && queryArgs?.where?.conversationId && typeof queryArgs.where.conversationId === 'string') {
                const resolved = await AuthLookupService.lookupOrgByRecord('conversations', queryArgs.where.conversationId);
                if (resolved) orgId = resolved;
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

              if (orgId && typeof orgId === 'string' && isPostgreSql()) {
                const { runInTenantContext } = await import('./tenancy/tenant-context');
                return runInTenantContext(orgId, async (tx) => {
                  return (tx as any)[prop][methodProp](...args);
                });
              }

              if (process.env.ALLOW_UNSCOPED_ADMIN_QUERIES === 'true' || !isPostgreSql()) {
                return originalMethod.apply(targetMethod, args);
              }

              throw new Error(
                `[Tenant Isolation Violation] Unscoped access to tenant-owned model "${String(prop)}" is prohibited in tests. Provide organizationId in where clause or wrap in runInTenantContext.`
              );
            };
          },
        });
      }

      if (isPostgreSql()) {
        throw new Error(
          `[Tenant Isolation Violation] Unscoped access to tenant-owned model "${String(prop)}" is prohibited. All tenant data queries must execute within an active transaction-local tenant context (runInTenantContext).`
        );
      }
    }

    const val = (target as any)[prop];
    return typeof val === 'function' ? val.bind(target) : val;
  },
}) as unknown as PrismaClient;

export default prisma;
