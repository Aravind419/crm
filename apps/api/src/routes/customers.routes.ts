import { Router, Response } from 'express';
import { prisma } from '../prisma';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { tenantIsolationGuard } from '../middleware/tenant';

const router = Router();

router.use(authMiddleware);
router.use(tenantIsolationGuard);

/**
 * GET /api/v1/customers
 */
router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { search } = req.query;
    const organizationId = req.organizationId!;

    const whereClause: any = { organizationId };

    if (search && String(search).trim()) {
      const q = String(search).trim();
      whereClause.OR = [
        { name: { contains: q } },
        { email: { contains: q } },
        { phone: { contains: q } },
      ];
    }

    const customers = await prisma.customer.findMany({
      where: whereClause,
      include: {
        _count: {
          select: {
            conversations: true,
            tickets: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ customers });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * GET /api/v1/customers/:id
 */
router.get('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const customerId = String(req.params.id);
    const customer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        organizationId: req.organizationId!,
      },
      include: {
        conversations: {
          orderBy: { lastMessageAt: 'desc' },
          include: {
            assignee: {
              select: { firstName: true, lastName: true },
            },
          },
        },
        tickets: {
          orderBy: { createdAt: 'desc' },
          include: {
            assignee: {
              select: { firstName: true, lastName: true },
            },
          },
        },
      },
    });

    if (!customer) {
      res.status(404).json({ error: 'Not Found', message: 'Customer not found' });
      return;
    }

    res.json({ customer });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

export default router;
