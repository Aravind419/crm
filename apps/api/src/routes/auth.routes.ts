import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma';
import { config } from '../config';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { rateLimiter } from '../middleware/rate-limiter';
import { disconnectUserSockets } from '../services/socket.service';

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

export async function createRefreshToken(userId: string, familyId?: string): Promise<string> {
  const rawToken = crypto.randomBytes(40).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + config.refreshTokenExpiresDays * 24 * 60 * 60 * 1000);
  const actualFamilyId = familyId || crypto.randomUUID();

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      familyId: actualFamilyId,
      expiresAt,
      revoked: false,
    },
  });

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

    const existingOrg = await prisma.organization.findUnique({ where: { slug } });
    if (existingOrg) {
      res.status(409).json({ error: 'Conflict', message: 'Organization slug is already taken' });
      return;
    }

    const hashedPassword = await hashPassword(password);

    const result = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
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

      return { organization, user, workspace, inbox };
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

    const refreshToken = await createRefreshToken(result.user.id);

    res.status(201).json({
      message: 'Organization and account successfully created',
      token,
      refreshToken,
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

    const user = await prisma.user.findFirst({
      where: {
        email: String(email).toLowerCase().trim(),
      },
      include: {
        organization: true,
      },
    });

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

    // DYNAMIC HASH UPGRADE: If user authenticated with legacy SHA-256 hash, upgrade to bcrypt immediately
    if (!user.passwordHash.startsWith('$2a$') && !user.passwordHash.startsWith('$2b$')) {
      const modernBcryptHash = await hashPassword(password);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: modernBcryptHash },
      });
      console.log(`[Security] Upgraded legacy password hash to bcrypt for user ${user.id}`);
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

    const refreshToken = await createRefreshToken(user.id);

    // Record audit event
    await prisma.auditEvent.create({
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
        id: user.organization.id,
        name: user.organization.name,
        slug: user.organization.slug,
        plan: user.organization.plan,
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

    // Atomic CAS rotation inside transaction to prevent concurrent refresh race conditions
    const result = await prisma.$transaction(async (tx) => {
      // 1. Atomically revoke ONLY if currently active and not expired, and record rotatedAt timestamp
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
        const storedToken = await tx.refreshToken.findUnique({
          where: { tokenHash },
          include: { user: true },
        });

        if (storedToken && storedToken.revoked) {
          // Distinguish near-simultaneous concurrency race from genuine later reuse attack
          const isConcurrentRace =
            storedToken.rotatedAt &&
            Date.now() - storedToken.rotatedAt.getTime() < 10000; // 10s grace window for concurrent requests

          if (!isConcurrentRace) {
            // Genuine reuse attack! Invalidate ONLY this compromised token family
            await tx.refreshToken.updateMany({
              where: { familyId: storedToken.familyId },
              data: { revoked: true },
            });

            // Log security audit event without exposing raw tokens
            await tx.auditEvent.create({
              data: {
                organizationId: storedToken.user.organizationId,
                userId: storedToken.userId,
                action: 'REFRESH_TOKEN_FAMILY_REVOKED',
                entityType: 'RefreshTokenFamily',
                entityId: storedToken.familyId,
                ipAddress: req.ip || req.socket.remoteAddress || null,
                metadata: JSON.stringify({
                  alert: 'Compromised refresh token reuse detected. Compromised token family revoked.',
                  familyId: storedToken.familyId,
                }),
              },
            });
          }
        }

        return null;
      }

      // 2. Fetch the existing token with its familyId
      const existingToken = await tx.refreshToken.findUnique({
        where: { tokenHash },
        include: {
          user: {
            include: { organization: true },
          },
        },
      });

      if (!existingToken || existingToken.user.status !== 'ACTIVE') {
        return null;
      }

      // 3. Issue new refresh token within the same transaction, maintaining the SAME familyId
      const newRawToken = crypto.randomBytes(40).toString('hex');
      const newTokenHash = crypto.createHash('sha256').update(newRawToken).digest('hex');
      const newExpiresAt = new Date(Date.now() + config.refreshTokenExpiresDays * 24 * 60 * 60 * 1000);

      await tx.refreshToken.create({
        data: {
          userId: existingToken.userId,
          tokenHash: newTokenHash,
          familyId: existingToken.familyId,
          expiresAt: newExpiresAt,
          revoked: false,
        },
      });

      const newAccessToken = jwt.sign(
        {
          userId: existingToken.user.id,
          organizationId: existingToken.user.organizationId,
          email: existingToken.user.email,
          role: existingToken.user.role,
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
      const stored = await prisma.refreshToken.findUnique({
        where: { tokenHash },
        select: { userId: true, familyId: true },
      });
      if (stored) {
        await prisma.refreshToken.updateMany({
          where: { familyId: stored.familyId },
          data: { revoked: true },
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
router.get('/me', authMiddleware, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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
});

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

    const user = await prisma.user.findUnique({
      where: { invitationTokenHash: tokenHash },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            logoUrl: true,
            brandColor: true,
          },
        },
      },
    });

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
      organization: user.organization,
      organizationName: user.organization.name,
      inviterName: 'Administrator',
      expiresAt: user.invitationExpiresAt,
      invitation: {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organizationName: user.organization.name,
        organization: user.organization,
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

    // Atomic transaction: Execute conditional update directly on database
    const { updatedUser, organization } = await prisma.$transaction(async (tx) => {
      // Find candidate by token hash first
      const candidate = await tx.user.findUnique({
        where: { invitationTokenHash: tokenHash },
        include: { organization: true },
      });

      if (!candidate) {
        const err: any = new Error('Invalid or already used invitation token');
        err.status = 404;
        throw err;
      }

      if (candidate.status !== 'INVITED') {
        const err: any = new Error('This invitation has already been accepted');
        err.status = 400;
        throw err;
      }

      if (!candidate.invitationExpiresAt || candidate.invitationExpiresAt <= now) {
        const err: any = new Error('This invitation has expired. Please request a new invitation.');
        err.status = 410;
        throw err;
      }

      // ATOMIC CONDITIONAL CONSUMPTION
      // Exactly one concurrent transaction can match status='INVITED' and valid tokenHash
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
        // Race condition: another concurrent request consumed this invitation first
        const err: any = new Error('This invitation has already been accepted or is currently being processed');
        err.status = 409;
        throw err;
      }

      // Fetch the updated user record
      const activated = await tx.user.findUniqueOrThrow({
        where: { id: candidate.id },
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

      return { updatedUser: activated, organization: candidate.organization };
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

    const refreshToken = await createRefreshToken(updatedUser.id);

    res.json({
      message: 'Account successfully activated',
      token: jwtToken,
      refreshToken,
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
