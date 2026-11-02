import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { tenantIsolationGuard } from '../middleware/tenant';
import { requireRoles } from '../middleware/roles';
import { EntitlementService } from '../services/entitlement.service';

const router = Router();

router.use(authMiddleware);
router.use(tenantIsolationGuard);

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
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
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to retrieve users' });
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
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update availability' });
  }
});

/**
 * POST /api/v1/users/invite
 * Admins invite a new agent to the organization.
 * ENFORCES: Entitlement limits and tenant-isolated team membership.
 */
router.post('/invite', requireRoles(['OWNER', 'ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { email, firstName, lastName, role, teamIds, initialPassword } = req.body;
    const organizationId = req.organizationId!;

    if (!email || !firstName || !lastName) {
      res.status(400).json({ error: 'Bad Request', message: 'Email, first name, and last name are required' });
      return;
    }

    // Entitlement Check: Verify agent seat limit under active subscription plan
    const agentCheck = await EntitlementService.canAddAgent(organizationId);
    if (!agentCheck.allowed) {
      res.status(403).json({
        error: 'Forbidden',
        message: `Agent limit reached. Your ${agentCheck.plan} plan allows up to ${agentCheck.max} agents. Upgrade your subscription to add more team members.`,
      });
      return;
    }

    const existing = await prisma.user.findFirst({
      where: {
        organizationId,
        email: email.toLowerCase().trim(),
      },
    });

    if (existing) {
      res.status(409).json({ error: 'Conflict', message: 'A user with this email already exists in your organization' });
      return;
    }

    // Verify teamIds belong to current organization
    if (teamIds && Array.isArray(teamIds) && teamIds.length > 0) {
      const validTeams = await prisma.team.findMany({
        where: { id: { in: teamIds }, organizationId },
        select: { id: true },
      });
      if (validTeams.length !== teamIds.length) {
        res.status(400).json({ error: 'Bad Request', message: 'One or more specified teams do not belong to your organization' });
        return;
      }
    }

    const passwordToHash = initialPassword || 'TempPass2026!';
    const hashedPassword = await hashPassword(passwordToHash);

    const user = await prisma.user.create({
      data: {
        organizationId,
        email: email.toLowerCase().trim(),
        passwordHash: hashedPassword,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
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
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to invite user' });
  }
});

export default router;
