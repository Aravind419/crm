import { basePrisma, isPostgreSql } from '../prisma';

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

/**
 * Enterprise Pre-Auth & Public Data Resolution Service
 *
 * Under PostgreSQL RLS, supportos_app operates with NOBYPASSRLS.
 * These methods utilize strictly defined, bounded SECURITY DEFINER functions
 * to resolve user/inbox/session identities prior to establishing
 * the transaction-local tenant context (app.current_organization_id).
 *
 * For local SQLite testing, transparent direct queries are utilized.
 */
export class AuthLookupService {
  /**
   * Resolves user and parent organization by email for authentication bootstrap.
   */
  static async lookupUserByEmail(email: string): Promise<AuthLookupUser | null> {
    if (!email || typeof email !== 'string') return null;
    const cleanEmail = email.toLowerCase().trim();

    if (isPostgreSql()) {
      const rows = await basePrisma.$queryRaw<any[]>`
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

    const user = await basePrisma.user.findFirst({
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
  }

  /**
   * Resolves refresh token, user, and tenant organization by token hash.
   */
  static async lookupRefreshToken(tokenHash: string): Promise<AuthLookupRefreshToken | null> {
    if (!tokenHash || typeof tokenHash !== 'string') return null;

    if (isPostgreSql()) {
      const rows = await basePrisma.$queryRaw<any[]>`
        SELECT * FROM auth_lookup_refresh_token(${tokenHash})
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

    const token = await basePrisma.refreshToken.findUnique({
      where: { tokenHash },
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
  }

  /**
   * Resolves invited agent user record and organization by invitation token hash.
   */
  static async lookupUserByInvitation(tokenHash: string): Promise<AuthLookupInvitation | null> {
    if (!tokenHash || typeof tokenHash !== 'string') return null;

    if (isPostgreSql()) {
      const rows = await basePrisma.$queryRaw<any[]>`
        SELECT * FROM auth_lookup_user_by_invitation(${tokenHash})
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

    const user = await basePrisma.user.findUnique({
      where: { invitationTokenHash: tokenHash },
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
  }

  /**
   * Resolves organization existence by slug during signup / help center lookup.
   */
  static async lookupOrgBySlug(slug: string): Promise<{ id: string; name: string; slug: string } | null> {
    if (!slug || typeof slug !== 'string') return null;
    const cleanSlug = slug.toLowerCase().trim();

    if (isPostgreSql()) {
      const rows = await basePrisma.$queryRaw<any[]>`
        SELECT * FROM auth_lookup_org_by_slug(${cleanSlug})
      `;
      if (!rows || rows.length === 0) return null;
      return {
        id: rows[0].id,
        name: rows[0].name,
        slug: rows[0].slug,
      };
    }

    const org = await basePrisma.organization.findUnique({
      where: { slug: cleanSlug },
      select: { id: true, name: true, slug: true },
    });
    return org;
  }

  /**
   * Resolves public inbox configuration and owning tenant by inboxKey.
   */
  static async lookupInboxByKey(inboxKey: string): Promise<PublicLookupInbox | null> {
    if (!inboxKey || typeof inboxKey !== 'string') return null;

    if (isPostgreSql()) {
      const rows = await basePrisma.$queryRaw<any[]>`
        SELECT * FROM public_lookup_inbox(${inboxKey})
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

    const inbox = await basePrisma.inbox.findUnique({
      where: { inboxKey },
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
  }

  /**
   * Resolves and verifies visitor session and its bound tenant by SHA-256 token hash.
   */
  static async lookupVisitorSession(tokenHash: string): Promise<PublicLookupVisitorSession | null> {
    if (!tokenHash || typeof tokenHash !== 'string') return null;

    if (isPostgreSql()) {
      const rows = await basePrisma.$queryRaw<any[]>`
        SELECT * FROM public_lookup_visitor_session(${tokenHash})
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

    const session = await basePrisma.visitorSession.findFirst({
      where: { tokenHash },
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
  }

  /**
   * Resolves organizationId for an arbitrary record by table name and ID.
   */
  static async lookupOrgByRecord(table: string, id: string): Promise<string | null> {
    if (!table || !id || typeof id !== 'string') return null;

    if (isPostgreSql()) {
      const rows = await basePrisma.$queryRaw<any[]>`
        SELECT auth_lookup_org_by_record(${table}, ${id}) AS org_id
      `;
      if (!rows || rows.length === 0 || !rows[0].org_id) return null;
      return rows[0].org_id;
    }

    // SQLite fallback
    try {
      const model = (basePrisma as any)[table.replace(/_([a-z])/g, (_, l) => l.toUpperCase()).replace(/s$/, '')];
      if (model && typeof model.findUnique === 'function') {
        const rec = await model.findUnique({ where: { id }, select: { organizationId: true } });
        return rec?.organizationId || null;
      }
    } catch (_) {}
    return null;
  }
}
