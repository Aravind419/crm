import { Router, Response } from 'express';
import * as crypto from 'crypto';
import { prisma } from '../prisma';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { tenantIsolationGuard } from '../middleware/tenant';
import { requireRoles } from '../middleware/roles';

const router = Router();

router.use(authMiddleware);
router.use(tenantIsolationGuard);

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password + 'supportos_salt_2026').digest('hex');
}

/**
 * GET /api/v1/users
 * List all agents and staff in the organization.
 */
router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      where: { organizationId: req.organizationId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        isAvailable: true,
        avatarUrl: true,
        createdAt: true,
        teamMemberships: {
          include: {
            team: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ users });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * PATCH /api/v1/users/availability
 * Agent toggles their own availability (online/away).
 */
router.patch('/availability', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { isAvailable } = req.body;

    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: { isAvailable: Boolean(isAvailable) },
      select: { id: true, isAvailable: true },
    });

    res.json({ user: updated, message: 'Availability status updated' });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * POST /api/v1/users/invite
 * Admins invite a new agent to the organization.
 */
router.post('/invite', requireRoles(['OWNER', 'ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { email, firstName, lastName, role, teamIds, initialPassword } = req.body;

    if (!email || !firstName || !lastName) {
      res.status(400).json({ error: 'Bad Request', message: 'Email, first name, and last name are required' });
      return;
    }

    const existing = await prisma.user.findFirst({
      where: {
        organizationId: req.organizationId!,
        email: email.toLowerCase(),
      },
    });

    if (existing) {
      res.status(409).json({ error: 'Conflict', message: 'A user with this email already exists in your organization' });
      return;
    }

    const passwordToHash = initialPassword || 'TempPass2026!';
    const user = await prisma.user.create({
      data: {
        organizationId: req.organizationId!,
        email: email.toLowerCase(),
        passwordHash: hashPassword(passwordToHash),
        firstName,
        lastName,
        role: role || 'AGENT',
        status: 'ACTIVE',
        isAvailable: true,
        ...(teamIds && Array.isArray(teamIds)
          ? {
              teamMemberships: {
                create: teamIds.map((teamId: string) => ({ teamId })),
              },
            }
          : {}),
      },
    });

    res.status(201).json({
      message: 'Agent successfully invited',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

export default router;
