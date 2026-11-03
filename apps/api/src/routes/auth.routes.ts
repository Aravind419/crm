import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { prisma, isPostgreSql } from '../prisma';
import { config } from '../config';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { tenantTransactionMiddleware } from '../middleware/tenant';
import { rateLimiter } from '../middleware/rate-limiter';
import { disconnectUserSockets } from '../services/socket.service';
import { runInTenantContext } from '../tenancy/tenant-context';
import { AuthLookupService } from '../tenancy/auth-lookup.service';

const router = Router();

// Rate limiter for authentication endpoints: max 20 attempts per 60 seconds (relaxed in test/dev harness)
const authRateLimiter = rateLimiter({
  windowMs: 60 * 1000,
  max: config.nodeEnv === 'production' ? 20 : 500,
  message: 'Too many authentication attempts. Please wait 1 minute before trying again.',
});

export function validatePasswordPolicy(password: string): { valid: boolean; message?: string } {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Password is required' };
  }
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters in length' };
  }
  if (password.length > 128) {
    return { valid: false, message: 'Password must not exceed 128 characters' };
  }
  return { valid: true };
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (hash.startsWith('$2a$') || hash.startsWith('$2b$')) {
    return bcrypt.compare(password, hash);
  }
  // Timing-safe fallback for legacy SHA-256 hashes during migration window
  try {
    const legacyHash = crypto.createHash('sha256').update(password + 'supportos_salt_2026').digest('hex');
    const legacyBuf = Buffer.from(legacyHash, 'utf8');
    const hashBuf = Buffer.from(hash, 'utf8');
    if (legacyBuf.length !== hashBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(legacyBuf, hashBuf);
  } catch {
    return false;
  }
}

export async function createRefreshToken(userId: string, organizationId?: string, familyId?: string): Promise<string> {
  const rawToken = crypto.randomBytes(40).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + config.refreshTokenExpiresDays * 24 * 60 * 60 * 1000);
  const actualFamilyId = familyId || crypto.randomUUID();

  const insertData = {
    userId,
    tokenHash,
    familyId: actualFamilyId,
    expiresAt,
    revoked: false,
  };

  if (organizationId) {
    await runInTenantContext(organizationId, async (tx) => {
      await tx.refreshToken.create({ data: insertData });
    });
  } else {
    await prisma.refreshToken.create({ data: insertData });
  }

  return rawToken;
}

/**
 * POST /api/v1/auth/signup
 */
router.post('/signup', authRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { orgName, orgSlug, email, password, firstName, lastName } = req.body;

    if (!orgName || !email || !password || !firstName || !lastName) {
      res.status(400).json({ error: 'Bad Request', message: 'Missing required signup fields' });
      return;
    }

    const passwordCheck = validatePasswordPolicy(password);
    if (!passwordCheck.valid) {
      res.status(400).json({ error: 'Bad Request', message: passwordCheck.message });
      return;
    }

    const slug = (orgSlug || orgName.toLowerCase().replace(/[^a-z0-9]/g, '-')).replace(/--+/g, '-');

    const existingOrg = await AuthLookupService.lookupOrgBySlug(slug);
    if (existingOrg) {
      res.status(409).json({ error: 'Conflict', message: 'Organization slug is already taken' });
      return;
    }

    const hashedPassword = await hashPassword(password);
    const newOrgId = crypto.randomUUID();

    const result = await runInTenantContext(newOrgId, async (tx) => {
      const organization = await tx.organization.create({
        data: {
          id: newOrgId,
          name: orgName,
          slug,
          plan: 'GROWTH',
          status: 'ACTIVE',
        },
      });

      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          email: email.toLowerCase().trim(),
          passwordHash: hashedPassword,
          firstName,
          lastName,
          role: 'OWNER',
          status: 'ACTIVE',
          isAvailable: true,
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          organizationId: organization.id,
          name: 'Primary Support',
          slug: 'primary',
        },
      });

      const inboxKey = `inbox_${slug}_${crypto.randomBytes(4).toString('hex')}`;
      const inbox = await tx.inbox.create({
        data: {
          organizationId: organization.id,
          workspaceId: workspace.id,
          name: 'Website Live Chat',
          channelType: 'WEB_WIDGET',
          inboxKey,
          widgetColor: '#2563EB',
          greeting: `Welcome to ${orgName} support! How can we assist you today?`,
        },
      });

      const rawRefreshToken = crypto.randomBytes(40).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
      const expiresAt = new Date(Date.now() + config.refreshTokenExpiresDays * 24 * 60 * 60 * 1000);

      await tx.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash,
          familyId: crypto.randomUUID(),
          expiresAt,
          revoked: false,
        },
      });

      return { organization, user, workspace, inbox, refreshToken: rawRefreshToken };
    });

    const token = jwt.sign(
      {
        userId: result.user.id,
        organizationId: result.organization.id,
        email: result.user.email,
        role: result.user.role,
      },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as any }
    );

    res.status(201).json({
      message: 'Organization and account successfully created',
      token,
      refreshToken: result.refreshToken,
      user: {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        role: result.user.role,
      },
      organization: {
        id: result.organization.id,
        name: result.organization.name,
        slug: result.organization.slug,
        plan: result.organization.plan,
        onboardingCompleted: result.organization.onboardingCompleted,
        onboardingStep: result.organization.onboardingStep,
        brandColor: result.organization.brandColor,
        timezone: result.organization.timezone,
        locale: result.organization.locale,
      },
    });
  } catch (err: any) {
    console.error('[Auth Signup Error]:', err);
    res.status(500).json({ error: 'Internal Server Error', message: 'An unexpected signup error occurred' });
  }
});

/**
 * POST /api/v1/auth/login
 */
router.post('/login', authRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Bad Request', message: 'Email and password are required' });
      return;
    }

    const user = await AuthLookupService.lookupUserByEmail(String(email));

    // Constant-time check mitigation: generic failure message for both non-existent user and wrong password
    if (!user) {
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid email or password' });
      return;
    }

    const isMatch = await verifyPassword(password, user.passwordHash);
    if (!isMatch) {
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid email or password' });
      return;
    }

    if (user.status !== 'ACTIVE') {
      res.status(403).json({ error: 'Forbidden', message: 'Account is deactivated' });
      return;
    }

    const token = jwt.sign(
      {
        userId: user.id,
        organizationId: user.organizationId,
        email: user.email,
        role: user.role,
      },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as any }
    );

    const refreshToken = await runInTenantContext(user.organizationId, async (tx) => {
      // DYNAMIC HASH UPGRADE: If user authenticated with legacy SHA-256 hash, upgrade to bcrypt immediately
      if (!user.passwordHash.startsWith('$2a$') && !user.passwordHash.startsWith('$2b$')) {
        const modernBcryptHash = await hashPassword(password);
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash: modernBcryptHash },
        });
        console.log(`[Security] Upgraded legacy password hash to bcrypt for user ${user.id}`);
      }

      const rawToken = crypto.randomBytes(40).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + config.refreshTokenExpiresDays * 24 * 60 * 60 * 1000);

      await tx.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash,
          familyId: crypto.randomUUID(),
          expiresAt,
          revoked: false,
        },
      });

      // Record audit event
      await tx.auditEvent.create({
        data: {
          organizationId: user.organizationId,
          userId: user.id,
          action: 'USER_LOGIN',
          entityType: 'User',
          entityId: user.id,
          ipAddress: req.ip || req.socket.remoteAddress || null,
          metadata: JSON.stringify({ email: user.email }),
        },
      }).catch(() => {});

      return rawToken;
    }, { actorId: user.id, actorType: 'AGENT' });

    res.json({
      token,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        isAvailable: user.isAvailable,
        avatarUrl: user.avatarUrl,
      },
      organization: {
        id: user.orgId,
        name: user.orgName,
        slug: user.orgSlug,
        plan: user.orgPlan,
      },
    });
  } catch (err: any) {
    console.error('[Auth Login Error]:', err);
    res.status(500).json({ error: 'Internal Server Error', message: 'An unexpected authentication error occurred' });
  }
});

/**
 * POST /api/v1/auth/refresh
 * ATOMIC REFRESH TOKEN ROTATION: CAS update ensures exactly one caller succeeds on concurrent calls.
 */
router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken || typeof refreshToken !== 'string') {
      res.status(400).json({ error: 'Bad Request', message: 'refreshToken is required' });
      return;
    }

    const tokenHash = crypto.createHash('sha256').update(refreshToken.trim()).digest('hex');

    const stored = await AuthLookupService.lookupRefreshToken(tokenHash);
    if (!stored) {
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid, expired, or already used refresh token' });
      return;
    }

    // Atomic CAS rotation inside transaction-local tenant context
    const result = await runInTenantContext(stored.organizationId, async (tx) => {
      const now = new Date();
      const updateCount = await tx.refreshToken.updateMany({
        where: {
          tokenHash,
          revoked: false,
          expiresAt: { gt: now },
        },
        data: {
          revoked: true,
          rotatedAt: now,
        },
      });

      if (updateCount.count === 0) {
        // Token was already revoked, expired, or non-existent
        if (stored.revoked) {
          const isConcurrentRace =
            stored.rotatedAt &&
            Date.now() - stored.rotatedAt.getTime() < 10000; // 10s grace window for concurrent requests

          if (!isConcurrentRace) {
            // Genuine reuse attack! Invalidate ONLY this compromised token family
            await tx.refreshToken.updateMany({
              where: { familyId: stored.familyId },
              data: { revoked: true },
            });

            // Log security audit event without exposing raw tokens
            await tx.auditEvent.create({
              data: {
                organizationId: stored.organizationId,
                userId: stored.userId,
                action: 'REFRESH_TOKEN_FAMILY_REVOKED',
                entityType: 'RefreshTokenFamily',
                entityId: stored.familyId,
                ipAddress: req.ip || req.socket.remoteAddress || null,
                metadata: JSON.stringify({
                  alert: 'Compromised refresh token reuse detected. Compromised token family revoked.',
                  familyId: stored.familyId,
                }),
              },
            }).catch(() => {});
          }
        }

        return null;
      }

      if (stored.userStatus !== 'ACTIVE') {
        return null;
      }

      // Issue new refresh token within the same transaction, maintaining the SAME familyId
      const newRawToken = crypto.randomBytes(40).toString('hex');
      const newTokenHash = crypto.createHash('sha256').update(newRawToken).digest('hex');
      const newExpiresAt = new Date(Date.now() + config.refreshTokenExpiresDays * 24 * 60 * 60 * 1000);

      await tx.refreshToken.create({
        data: {
          userId: stored.userId,
          tokenHash: newTokenHash,
          familyId: stored.familyId,
          expiresAt: newExpiresAt,
          revoked: false,
        },
      });

      const newAccessToken = jwt.sign(
        {
          userId: stored.userId,
          organizationId: stored.organizationId,
          email: stored.email,
          role: stored.role,
        },
        config.jwtSecret,
        { expiresIn: config.jwtExpiresIn as any }
      );

      return {
        accessToken: newAccessToken,
        refreshToken: newRawToken,
      };
    });

    if (!result) {
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid, expired, or already used refresh token' });
      return;
    }

    res.json({
      token: result.accessToken,
      refreshToken: result.refreshToken,
      message: 'Token rotated successfully',
    });
  } catch (err: any) {
    console.error('[Auth Refresh Error]:', err);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to refresh token' });
  }
});

/**
 * POST /api/v1/auth/logout
 * Revokes refresh token.
 */
router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken && typeof refreshToken === 'string') {
      const tokenHash = crypto.createHash('sha256').update(refreshToken.trim()).digest('hex');
      const stored = await AuthLookupService.lookupRefreshToken(tokenHash);
      if (stored) {
        await runInTenantContext(stored.organizationId, async (tx) => {
          await tx.refreshToken.updateMany({
            where: { familyId: stored.familyId },
            data: { revoked: true },
          });
        });
        disconnectUserSockets(stored.userId);
      }
    }

    res.json({ message: 'Successfully logged out' });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to complete logout' });
  }
});

/**
 * GET /api/v1/auth/me
 */
router.get(
  '/me',
  authMiddleware,
  tenantTransactionMiddleware,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              slug: true,
              plan: true,
              status: true,
              createdAt: true,
            },
          },
          teamMemberships: {
            include: {
              team: true,
            },
          },
        },
      });

      if (!user) {
        res.status(404).json({ error: 'Not Found', message: 'User not found' });
        return;
      }

      res.json({
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          isAvailable: user.isAvailable,
          avatarUrl: user.avatarUrl,
          teams: user.teamMemberships.map((m) => ({ id: m.team.id, name: m.team.name })),
        },
        organization: user.organization,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Internal Server Error', message: 'Failed to retrieve profile' });
    }
  }
);

/**
 * GET /api/v1/auth/session-identity
 * Runtime identity & transaction context inspection endpoint.
 * Allows independent verification of the actual database identity (supportos_app)
 * and transaction-local tenant context (app.current_organization_id) without leaking credentials.
 */
router.get(
  '/session-identity',
  authMiddleware,
  tenantTransactionMiddleware,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      if (isPostgreSql()) {
        const idQuery: any[] = await prisma.$queryRawUnsafe(`
          SELECT 
            current_user AS "currentUser", 
            session_user AS "sessionUser", 
            current_database() AS "currentDatabase", 
            current_setting('app.current_organization_id', true) AS "currentOrganizationId";
        `);
        res.json({
          provider: 'postgresql',
          currentUser: idQuery[0]?.currentUser,
          sessionUser: idQuery[0]?.sessionUser,
          currentDatabase: idQuery[0]?.currentDatabase,
          currentOrganizationId: idQuery[0]?.currentOrganizationId,
        });
      } else {
        res.json({
          provider: 'sqlite',
          currentUser: 'sqlite_local',
          sessionUser: 'sqlite_local',
          currentDatabase: 'dev.db',
          currentOrganizationId: req.organizationId,
        });
      }
    } catch (err: any) {
      res.status(500).json({ error: 'Internal Server Error', message: 'Failed to inspect session identity' });
    }
  }
);

/**
 * GET /api/v1/auth/invitations/:token
 * Public endpoint to preview and validate an agent invitation token before acceptance.
 */
router.get('/invitations/:token', async (req: Request, res: Response): Promise<void> => {
  try {
    const rawToken = String(req.params.token || '').trim();
    if (!rawToken || rawToken.length < 32) {
      res.status(400).json({ error: 'Bad Request', message: 'Valid invitation token is required' });
      return;
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const user = await AuthLookupService.lookupUserByInvitation(tokenHash);

    if (!user) {
      res.status(404).json({ error: 'Not Found', message: 'Invalid or already used invitation token' });
      return;
    }

    if (user.status !== 'INVITED') {
      res.status(400).json({ error: 'Bad Request', message: 'This invitation has already been accepted' });
      return;
    }

    if (!user.invitationExpiresAt || user.invitationExpiresAt < new Date()) {
      res.status(410).json({ error: 'Gone', message: 'This invitation has expired. Please ask your administrator to resend it.' });
      return;
    }

    res.json({
      valid: true,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      organization: {
        id: user.orgId,
        name: user.orgName,
        slug: user.orgSlug,
        logoUrl: user.orgLogoUrl,
        brandColor: user.orgBrandColor,
      },
      organizationName: user.orgName,
      inviterName: 'Administrator',
      expiresAt: user.invitationExpiresAt,
      invitation: {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organizationName: user.orgName,
        organization: {
          id: user.orgId,
          name: user.orgName,
          slug: user.orgSlug,
          logoUrl: user.orgLogoUrl,
          brandColor: user.orgBrandColor,
        },
        inviterName: 'Administrator',
        expiresAt: user.invitationExpiresAt,
      },
    });
  } catch (err: any) {
    console.error('[Auth Invitation Preview Error]:', err);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to inspect invitation' });
  }
});

/**
 * POST /api/v1/auth/invitations/accept
 * Public endpoint for an invited agent to set their password and activate their account.
 * Single-use: invalidates invitationTokenHash immediately upon acceptance.
 */
router.post('/invitations/accept', authRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, password, firstName, lastName } = req.body;

    const rawToken = String(token || '').trim();
    if (!rawToken || rawToken.length < 32) {
      res.status(400).json({ error: 'Bad Request', message: 'Valid invitation token is required' });
      return;
    }

    if (!password) {
      res.status(400).json({ error: 'Bad Request', message: 'Password is required' });
      return;
    }

    const passwordCheck = validatePasswordPolicy(password);
    if (!passwordCheck.valid) {
      res.status(400).json({ error: 'Bad Request', message: passwordCheck.message });
      return;
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const now = new Date();
    const hashedPassword = await hashPassword(password);

    const candidate = await AuthLookupService.lookupUserByInvitation(tokenHash);

    if (!candidate) {
      res.status(404).json({ error: 'Not Found', message: 'Invalid or already used invitation token' });
      return;
    }

    if (candidate.status !== 'INVITED') {
      res.status(400).json({ error: 'Bad Request', message: 'This invitation has already been accepted' });
      return;
    }

    if (!candidate.invitationExpiresAt || candidate.invitationExpiresAt <= now) {
      res.status(410).json({ error: 'Gone', message: 'This invitation has expired. Please request a new invitation.' });
      return;
    }

    // Atomic transaction under transaction-local PostgreSQL RLS context
    const { updatedUser, organization } = await runInTenantContext(candidate.organizationId, async (tx) => {
      // ATOMIC CONDITIONAL CONSUMPTION: exactly one concurrent transaction can succeed
      const updateResult = await tx.user.updateMany({
        where: {
          id: candidate.id,
          invitationTokenHash: tokenHash,
          status: 'INVITED',
          invitationExpiresAt: { gt: now },
        },
        data: {
          passwordHash: hashedPassword,
          status: 'ACTIVE',
          invitationTokenHash: null,
          invitationExpiresAt: null,
          ...(firstName && typeof firstName === 'string' && firstName.trim() ? { firstName: firstName.trim() } : {}),
          ...(lastName && typeof lastName === 'string' && lastName.trim() ? { lastName: lastName.trim() } : {}),
        },
      });

      if (updateResult.count !== 1) {
        const err: any = new Error('This invitation has already been accepted or is currently being processed');
        err.status = 409;
        throw err;
      }

      const activated = await tx.user.findUniqueOrThrow({
        where: { id: candidate.id },
      });

      const org = await tx.organization.findUniqueOrThrow({
        where: { id: candidate.organizationId },
      });

      // Write audit event
      await tx.auditEvent.create({
        data: {
          organizationId: candidate.organizationId,
          userId: candidate.id,
          action: 'INVITATION_ACCEPTED',
          entityType: 'User',
          entityId: candidate.id,
          ipAddress: req.ip || req.socket.remoteAddress || null,
          metadata: JSON.stringify({ email: candidate.email, role: candidate.role }),
        },
      });

      return { updatedUser: activated, organization: org };
    });

    const jwtToken = jwt.sign(
      {
        userId: updatedUser.id,
        organizationId: updatedUser.organizationId,
        email: updatedUser.email,
        role: updatedUser.role,
      },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as any }
    );

    const rawRefreshToken = await createRefreshToken(updatedUser.id, updatedUser.organizationId);

    res.json({
      message: 'Account successfully activated',
      token: jwtToken,
      refreshToken: rawRefreshToken,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        role: updatedUser.role,
        status: updatedUser.status,
      },
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      },
    });
  } catch (err: any) {
    const status = err.status || 500;
    if (status !== 500) {
      const errorLabel =
        status === 400 ? 'Bad Request' : status === 404 ? 'Not Found' : status === 410 ? 'Gone' : 'Conflict';
      res.status(status).json({ error: errorLabel, message: err.message });
      return;
    }
    console.error('[Auth Accept Invitation Error]:', err);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to accept invitation' });
  }
});

export default router;
