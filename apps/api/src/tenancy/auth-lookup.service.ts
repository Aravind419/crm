import { executeReadOnlyLookup, isPostgreSql } from '../prisma';

export interface AuthLookupUser {
  id: string;
  organizationId: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  isAvailable: boolean;
  avatarUrl: string | null;
  orgId: string;
  orgName: string;
  orgSlug: string;
  orgPlan: string;
  orgStatus: string;
}

export interface AuthLookupRefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  revoked: boolean;
  expiresAt: Date;
  rotatedAt: Date | null;
  organizationId: string;
  userStatus: string;
  email: string;
  role: string;
}

export interface AuthLookupInvitation {
  id: string;
  organizationId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  invitationExpiresAt: Date | null;
  orgId: string;
  orgName: string;
  orgSlug: string;
  orgLogoUrl: string | null;
  orgBrandColor: string | null;
}

export interface PublicLookupInbox {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  name: string;
  channelType: string;
  widgetColor: string;
  greeting: string;
  allowedOrigins: string | null;
  orgId: string;
  orgName: string;
  orgSlug: string;
}

export interface PublicLookupVisitorSession {
  id: string;
  inboxId: string;
  customerId: string;
  conversationId: string | null;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  organizationId: string;
}

const ALLOWED_RECORD_TABLES = new Set([
  'organizations',
  'workspaces',
  'users',
  'teams',
  'team_members',
  'inboxes',
  'customers',
  'conversations',
  'messages',
  'attachments',
  'tickets',
  'ticket_comments',
  'categories',
  'articles',
  'automation_rules',
  'audit_events',
  'refresh_tokens',
  'webhook_events',
  'visitor_sessions',
]);

const TABLE_TO_PRISMA_MODEL: Record<string, string> = {
  organizations: 'organization',
  workspaces: 'workspace',
  users: 'user',
  teams: 'team',
  team_members: 'teamMember',
  inboxes: 'inbox',
  customers: 'customer',
  conversations: 'conversation',
  messages: 'message',
  attachments: 'attachment',
  tickets: 'ticket',
  ticket_comments: 'ticketComment',
  categories: 'category',
  articles: 'article',
  automation_rules: 'automationRule',
  audit_events: 'auditEvent',
  refresh_tokens: 'refreshToken',
  webhook_events: 'webhookEvent',
  visitor_sessions: 'visitorSession',
};

/**
 * Enterprise Pre-Auth & Public Data Resolution Service
 *
 * Provides narrowly scoped, read-only pre-authentication and identity bootstrap functions.
 * All queries are wrapped inside `executeReadOnlyLookup`, which enforces read-only transactions
 * and prevents any write or administrative operation.
 *
 * Documented Unavoidable Privileged Lookups:
 * 1. `lookupUserByEmail`: Pre-auth credential verification (POST /api/v1/auth/login).
 *    Retrieves user record and bcrypt passwordHash before establishing the tenant session.
 * 2. `lookupRefreshToken`: Token rotation (POST /api/v1/auth/refresh) and session termination.
 *    Validates cryptographic tokenHash and locates the bound user and tenant.
 * 3. `lookupUserByInvitation`: Agent invitation redemption (GET /invite/:token, accept).
 *    Resolves invitation metadata and branding without exposing password secrets.
 * 4. `lookupInboxByKey`: Public chat widget initialization (GET /api/v1/public/inbox/:inboxKey).
 *    Resolves public greeting, styling, and tenant binding for web visitors.
 * 5. `lookupVisitorSession`: Visitor authentication on public endpoints and WebSocket.
 *    Maps SHA-256 session token to customer, inbox, and tenant context.
 * 6. `lookupOrgBySlug`: Public knowledge base routing and registration uniqueness checks.
 */
export class AuthLookupService {
  /**
   * Resolves user and parent organization by email for authentication bootstrap.
   * Input validated: email string, 3..255 characters with '@'.
   */
  static async lookupUserByEmail(email: string): Promise<AuthLookupUser | null> {
    if (!email || typeof email !== 'string') return null;
    const cleanEmail = email.toLowerCase().trim();
    if (cleanEmail.length < 3 || cleanEmail.length > 255 || !cleanEmail.includes('@')) {
      return null;
    }

    return executeReadOnlyLookup(async (tx) => {
      if (isPostgreSql()) {
        const rows = await tx.$queryRaw<any[]>`
          SELECT * FROM auth_lookup_user_by_email(${cleanEmail})
        `;
        if (!rows || rows.length === 0) return null;
        const r = rows[0];
        return {
          id: r.id,
          organizationId: r.organizationId,
          email: r.email,
          passwordHash: r.passwordHash,
          firstName: r.firstName,
          lastName: r.lastName,
          role: r.role,
          status: r.status,
          isAvailable: Boolean(r.isAvailable),
          avatarUrl: r.avatarUrl,
          orgId: r.orgId,
          orgName: r.orgName,
          orgSlug: r.orgSlug,
          orgPlan: r.orgPlan,
          orgStatus: r.orgStatus,
        };
      }

      const user = await tx.user.findFirst({
        where: { email: cleanEmail },
        include: { organization: true },
      });

      if (!user) return null;
      return {
        id: user.id,
        organizationId: user.organizationId,
        email: user.email,
        passwordHash: user.passwordHash,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        status: user.status,
        isAvailable: user.isAvailable,
        avatarUrl: user.avatarUrl,
        orgId: user.organization.id,
        orgName: user.organization.name,
        orgSlug: user.organization.slug,
        orgPlan: user.organization.plan,
        orgStatus: user.organization.status,
      };
    });
  }

  /**
   * Resolves refresh token, user, and tenant organization by token hash.
   * Input validated: 64-character SHA-256 hex string.
   */
  static async lookupRefreshToken(tokenHash: string): Promise<AuthLookupRefreshToken | null> {
    if (!tokenHash || typeof tokenHash !== 'string') return null;
    const cleanHash = tokenHash.trim().toLowerCase();
    if (cleanHash.length !== 64 || !/^[a-f0-9]{64}$/.test(cleanHash)) {
      return null;
    }

    return executeReadOnlyLookup(async (tx) => {
      if (isPostgreSql()) {
        const rows = await tx.$queryRaw<any[]>`
          SELECT * FROM auth_lookup_refresh_token(${cleanHash})
        `;
        if (!rows || rows.length === 0) return null;
        const r = rows[0];
        return {
          id: r.id,
          userId: r.userId,
          tokenHash: r.tokenHash,
          familyId: r.familyId,
          revoked: Boolean(r.revoked),
          expiresAt: new Date(r.expiresAt),
          rotatedAt: r.rotatedAt ? new Date(r.rotatedAt) : null,
          organizationId: r.organizationId,
          userStatus: r.userStatus,
          email: r.email,
          role: r.role,
        };
      }

      const token = await tx.refreshToken.findUnique({
        where: { tokenHash: cleanHash },
        include: { user: true },
      });

      if (!token) return null;
      return {
        id: token.id,
        userId: token.userId,
        tokenHash: token.tokenHash,
        familyId: token.familyId,
        revoked: token.revoked,
        expiresAt: token.expiresAt,
        rotatedAt: token.rotatedAt,
        organizationId: token.user.organizationId,
        userStatus: token.user.status,
        email: token.user.email,
        role: token.user.role,
      };
    });
  }

  /**
   * Resolves invited agent user record and organization by invitation token hash.
   * Input validated: 64-character SHA-256 hex string.
   * Does NOT disclose passwordHash.
   */
  static async lookupUserByInvitation(tokenHash: string): Promise<AuthLookupInvitation | null> {
    if (!tokenHash || typeof tokenHash !== 'string') return null;
    const cleanHash = tokenHash.trim().toLowerCase();
    if (cleanHash.length !== 64 || !/^[a-f0-9]{64}$/.test(cleanHash)) {
      return null;
    }

    return executeReadOnlyLookup(async (tx) => {
      if (isPostgreSql()) {
        const rows = await tx.$queryRaw<any[]>`
          SELECT * FROM auth_lookup_user_by_invitation(${cleanHash})
        `;
        if (!rows || rows.length === 0) return null;
        const r = rows[0];
        return {
          id: r.id,
          organizationId: r.organizationId,
          email: r.email,
          firstName: r.firstName,
          lastName: r.lastName,
          role: r.role,
          status: r.status,
          invitationExpiresAt: r.invitationExpiresAt ? new Date(r.invitationExpiresAt) : null,
          orgId: r.orgId,
          orgName: r.orgName,
          orgSlug: r.orgSlug,
          orgLogoUrl: r.orgLogoUrl,
          orgBrandColor: r.orgBrandColor,
        };
      }

      const user = await tx.user.findUnique({
        where: { invitationTokenHash: cleanHash },
        include: { organization: true },
      });

      if (!user) return null;
      return {
        id: user.id,
        organizationId: user.organizationId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        status: user.status,
        invitationExpiresAt: user.invitationExpiresAt,
        orgId: user.organization.id,
        orgName: user.organization.name,
        orgSlug: user.organization.slug,
        orgLogoUrl: user.organization.logoUrl,
        orgBrandColor: user.organization.brandColor,
      };
    });
  }

  /**
   * Resolves organization existence by slug during signup / help center lookup.
   * Input validated: 1..100 alphanumeric and hyphen characters.
   */
  static async lookupOrgBySlug(slug: string): Promise<{ id: string; name: string; slug: string } | null> {
    if (!slug || typeof slug !== 'string') return null;
    const cleanSlug = slug.toLowerCase().trim();
    if (cleanSlug.length < 1 || cleanSlug.length > 100 || !/^[a-z0-9-]+$/.test(cleanSlug)) {
      return null;
    }

    return executeReadOnlyLookup(async (tx) => {
      if (isPostgreSql()) {
        const rows = await tx.$queryRaw<any[]>`
          SELECT * FROM auth_lookup_org_by_slug(${cleanSlug})
        `;
        if (!rows || rows.length === 0) return null;
        return {
          id: rows[0].id,
          name: rows[0].name,
          slug: rows[0].slug,
        };
      }

      const org = await tx.organization.findUnique({
        where: { slug: cleanSlug },
        select: { id: true, name: true, slug: true },
      });
      return org;
    });
  }

  /**
   * Resolves public inbox configuration and owning tenant by inboxKey.
   * Input validated: 1..128 characters alphanumeric and hyphen/underscore.
   */
  static async lookupInboxByKey(inboxKey: string): Promise<PublicLookupInbox | null> {
    if (!inboxKey || typeof inboxKey !== 'string') return null;
    const cleanKey = inboxKey.trim();
    if (cleanKey.length < 1 || cleanKey.length > 128) return null;

    return executeReadOnlyLookup(async (tx) => {
      if (isPostgreSql()) {
        const rows = await tx.$queryRaw<any[]>`
          SELECT * FROM public_lookup_inbox(${cleanKey})
        `;
        if (!rows || rows.length === 0) return null;
        const r = rows[0];
        return {
          id: r.id,
          organizationId: r.organizationId,
          workspaceId: r.workspaceId,
          name: r.name,
          channelType: r.channelType,
          widgetColor: r.widgetColor,
          greeting: r.greeting,
          allowedOrigins: r.allowedOrigins,
          orgId: r.orgId,
          orgName: r.orgName,
          orgSlug: r.orgSlug,
        };
      }

      const inbox = await tx.inbox.findUnique({
        where: { inboxKey: cleanKey },
        include: { organization: true },
      });

      if (!inbox) return null;
      return {
        id: inbox.id,
        organizationId: inbox.organizationId,
        workspaceId: inbox.workspaceId,
        name: inbox.name,
        channelType: inbox.channelType,
        widgetColor: inbox.widgetColor,
        greeting: inbox.greeting,
        allowedOrigins: inbox.allowedOrigins,
        orgId: inbox.organization.id,
        orgName: inbox.organization.name,
        orgSlug: inbox.organization.slug,
      };
    });
  }

  /**
   * Resolves and verifies visitor session and its bound tenant by SHA-256 token hash.
   * Input validated: 64-character SHA-256 hex string.
   */
  static async lookupVisitorSession(tokenHash: string): Promise<PublicLookupVisitorSession | null> {
    if (!tokenHash || typeof tokenHash !== 'string') return null;
    const cleanHash = tokenHash.trim().toLowerCase();
    if (cleanHash.length !== 64 || !/^[a-f0-9]{64}$/.test(cleanHash)) {
      return null;
    }

    return executeReadOnlyLookup(async (tx) => {
      if (isPostgreSql()) {
        const rows = await tx.$queryRaw<any[]>`
          SELECT * FROM public_lookup_visitor_session(${cleanHash})
        `;
        if (!rows || rows.length === 0) return null;
        const r = rows[0];
        return {
          id: r.id,
          inboxId: r.inboxId,
          customerId: r.customerId,
          conversationId: r.conversationId,
          tokenHash: r.tokenHash,
          expiresAt: new Date(r.expiresAt),
          revokedAt: r.revokedAt ? new Date(r.revokedAt) : null,
          organizationId: r.organizationId,
        };
      }

      const session = await tx.visitorSession.findFirst({
        where: { tokenHash: cleanHash },
        include: { inbox: true },
      });

      if (!session) return null;
      return {
        id: session.id,
        inboxId: session.inboxId,
        customerId: session.customerId,
        conversationId: session.conversationId,
        tokenHash: session.tokenHash,
        expiresAt: session.expiresAt,
        revokedAt: session.revokedAt,
        organizationId: session.inbox.organizationId,
      };
    });
  }

  /**
   * Resolves organizationId for an arbitrary record by table name and ID.
   * Input validated: table name must exist in ALLOWED_RECORD_TABLES whitelist; id <= 128 chars.
   */
  static async lookupOrgByRecord(table: string, id: string): Promise<string | null> {
    if (!table || !id || typeof id !== 'string' || typeof table !== 'string') return null;
    if (id.length > 128 || !ALLOWED_RECORD_TABLES.has(table)) return null;

    return executeReadOnlyLookup(async (tx) => {
      if (isPostgreSql()) {
        try {
          const rows = await tx.$queryRaw<any[]>`
            SELECT auth_lookup_org_by_record(${table}, ${id}) AS org_id
          `;
          if (!rows || rows.length === 0 || !rows[0].org_id) return null;
          return rows[0].org_id;
        } catch {
          return null;
        }
      }

      // SQLite fallback
      try {
        const modelName = TABLE_TO_PRISMA_MODEL[table];
        if (modelName && (tx as any)[modelName]) {
          const model = (tx as any)[modelName];
          if (table === 'visitor_sessions') {
            const rec = await model.findUnique({
              where: { id },
              select: { inbox: { select: { organizationId: true } } },
            });
            if (rec?.inbox?.organizationId) return rec.inbox.organizationId;
          } else if (table === 'refresh_tokens') {
            const rec = await model.findUnique({
              where: { id },
              select: { user: { select: { organizationId: true } } },
            });
            if (rec?.user?.organizationId) return rec.user.organizationId;
          } else if (table === 'webhook_events') {
            let rec = await model.findUnique({
              where: { id },
              select: { organizationId: true },
            }).catch(() => null);
            if (!rec) {
              rec = await model.findUnique({
                where: { eventId: id },
                select: { organizationId: true },
              }).catch(() => null);
            }
            if (rec?.organizationId) return rec.organizationId;
          } else if (table === 'team_members') {
            const rec = await model.findUnique({
              where: { id },
              select: { team: { select: { organizationId: true } } },
            });
            if (rec?.team?.organizationId) return rec.team.organizationId;
          } else {
            const rec = await model.findUnique({ where: { id }, select: { organizationId: true } });
            if (rec?.organizationId) return rec.organizationId;
          }
        }
      } catch (_) {}
      return null;
    });
  }
}
