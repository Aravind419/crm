import { Router, Response } from 'express';
import { prisma } from '../prisma';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { tenantIsolationGuard } from '../middleware/tenant';
import { requireRoles } from '../middleware/roles';

const router = Router();

router.use(authMiddleware);
router.use(tenantIsolationGuard);

/**
 * GET /api/v1/teams
 */
router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const teams = await prisma.team.findMany({
      where: { organizationId: req.organizationId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                role: true,
                avatarUrl: true,
                isAvailable: true,
              },
            },
          },
        },
        _count: {
          select: {
            conversations: true,
            tickets: true,
          },
        },
      },
    });

    res.json({ teams });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * POST /api/v1/teams
 */
router.post('/', requireRoles(['OWNER', 'ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, description, memberUserIds } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Bad Request', message: 'Team name is required' });
      return;
    }

    const team = await prisma.team.create({
      data: {
        organizationId: req.organizationId!,
        name,
        description,
        ...(memberUserIds && Array.isArray(memberUserIds)
          ? {
              members: {
                create: memberUserIds.map((userId: string) => ({ userId })),
              },
            }
          : {}),
      },
      include: {
        members: {
          include: {
            user: true,
          },
        },
      },
    });

    res.status(201).json({ team, message: 'Team created successfully' });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

export default router;
