import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma';
import { config } from '../config';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // Check bcrypt hash
  if (hash.startsWith('$2a$') || hash.startsWith('$2b$')) {
    return bcrypt.compare(password, hash);
  }
  // Fallback for legacy seeded hashes
  const legacyHash = crypto.createHash('sha256').update(password + 'supportos_salt_2026').digest('hex');
  return legacyHash === hash;
}

/**
 * POST /api/v1/auth/signup
 */
router.post('/signup', async (req: Request, res: Response): Promise<void> => {
  try {
    const { orgName, orgSlug, email, password, firstName, lastName } = req.body;

    if (!orgName || !email || !password || !firstName || !lastName) {
      res.status(400).json({ error: 'Bad Request', message: 'Missing required signup fields' });
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
          email: email.toLowerCase(),
          passwordHash: hashedPassword,
          firstName,
          lastName,
          role: 'OWNER',
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
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Organization and account successfully created',
      token,
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
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * POST /api/v1/auth/login
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Bad Request', message: 'Email and password are required' });
      return;
    }

    const user = await prisma.user.findFirst({
      where: {
        email: email.toLowerCase(),
      },
      include: {
        organization: true,
      },
    });

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
      { expiresIn: '7d' }
    );

    res.json({
      token,
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
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
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
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

export default router;
