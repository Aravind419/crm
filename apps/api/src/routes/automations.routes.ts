import { Router, Response } from 'express';
import { prisma } from '../prisma';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { tenantIsolationGuard, tenantTransactionMiddleware } from '../middleware/tenant';
import { requireRoles } from '../middleware/roles';

const router = Router();

router.use(authMiddleware);
router.use(tenantIsolationGuard);
router.use(tenantTransactionMiddleware);

/**
 * GET /api/v1/automations
 */
router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const rules = await prisma.automationRule.findMany({
      where: { organizationId: req.organizationId },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ rules });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * POST /api/v1/automations
 */
router.post('/', requireRoles(['OWNER', 'ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, description, triggerEvent, conditions, actions, isActive } = req.body;

    if (!name || !triggerEvent || !conditions || !actions) {
      res.status(400).json({ error: 'Bad Request', message: 'Name, triggerEvent, conditions, and actions are required' });
      return;
    }

    const rule = await prisma.automationRule.create({
      data: {
        organizationId: req.organizationId!,
        name,
        description,
        triggerEvent,
        conditions: typeof conditions === 'string' ? conditions : JSON.stringify(conditions),
        actions: typeof actions === 'string' ? actions : JSON.stringify(actions),
        isActive: isActive !== undefined ? Boolean(isActive) : true,
      },
    });

    res.status(201).json({ rule, message: 'Automation rule created successfully' });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

export default router;
