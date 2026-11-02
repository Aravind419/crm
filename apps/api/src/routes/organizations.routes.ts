import { Router, Response } from 'express';
import { prisma } from '../prisma';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { tenantIsolationGuard } from '../middleware/tenant';
import { requireRoles } from '../middleware/roles';

const router = Router();

router.use(authMiddleware);
router.use(tenantIsolationGuard);

/**
 * GET /api/v1/organizations/current
 */
router.get('/current', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: req.organizationId },
      include: {
        workspaces: true,
        _count: {
          select: {
            users: true,
            inboxes: true,
            conversations: true,
            tickets: true,
          },
        },
      },
    });

    if (!org) {
      res.status(404).json({ error: 'Not Found', message: 'Organization not found' });
      return;
    }

    res.json({ organization: org });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * PATCH /api/v1/organizations/current
 */
router.patch('/current', requireRoles(['OWNER', 'ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, plan } = req.body;

    const updated = await prisma.organization.update({
      where: { id: req.organizationId },
      data: {
        ...(name ? { name } : {}),
        ...(plan ? { plan } : {}),
      },
    });

    res.json({ organization: updated, message: 'Organization updated successfully' });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

export default router;
