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

// Rate limiter for authentication endpoints: max 20 attempts per 60 seconds
const authRateLimiter = rateLimiter({
  windowMs: 60 * 1000,
  max: 20,
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
  // Fallback for legacy seeded hashes
  const legacyHash = crypto.createHash('sha256').update(password + 'supportos_salt_2026').digest('hex');
  return legacyHash === hash;
}

export async function createRefreshToken(userId: string): Promise<string> {
  const rawToken = crypto.randomBytes(40).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + config.refreshTokenExpiresDays * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
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
      // 1. Atomically revoke ONLY if currently active and not expired
      const updateCount = await tx.refreshToken.updateMany({
        where: {
          tokenHash,
          revoked: false,
          expiresAt: { gt: new Date() },
        },
        data: {
          revoked: true,
        },
      });

      if (updateCount.count === 0) {
        // Token was already revoked, expired, or non-existent
        const compromisedToken = await tx.refreshToken.findUnique({
          where: { tokenHash },
          include: { user: true },
        });

        if (compromisedToken && compromisedToken.revoked) {
          // Token reuse / theft detected! Invalidate entire token family for this user
          await tx.refreshToken.updateMany({
            where: { userId: compromisedToken.userId },
            data: { revoked: true },
          });

          await tx.auditEvent.create({
            data: {
              organizationId: compromisedToken.user.organizationId,
              userId: compromisedToken.userId,
              action: 'REFRESH_TOKEN_REUSE_DETECTED',
              entityType: 'RefreshToken',
              entityId: tokenHash,
              ipAddress: req.ip || req.socket.remoteAddress || null,
              metadata: JSON.stringify({
                alert: 'Compromised refresh token reuse attempt detected. All active user refresh tokens revoked.',
              }),
            },
          }).catch(() => {});
        }

        return null;
      }

      // 2. Fetch the user associated with this token
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

      // 3. Issue new refresh token within the same transaction
      const newRawToken = crypto.randomBytes(40).toString('hex');
      const newTokenHash = crypto.createHash('sha256').update(newRawToken).digest('hex');
      const newExpiresAt = new Date(Date.now() + config.refreshTokenExpiresDays * 24 * 60 * 60 * 1000);

      await tx.refreshToken.create({
        data: {
          userId: existingToken.userId,
          tokenHash: newTokenHash,
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
        select: { userId: true },
      });
      await prisma.refreshToken.updateMany({
        where: { tokenHash },
        data: { revoked: true },
      });
      if (stored) {
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

export default router;
