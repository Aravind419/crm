import { Router, Response } from 'express';
import * as crypto from 'crypto';
import { prisma } from '../prisma';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { tenantIsolationGuard } from '../middleware/tenant';
import { requireRoles } from '../middleware/roles';

const router = Router();

router.use(authMiddleware);
router.use(tenantIsolationGuard);

/**
 * GET /api/v1/inboxes
 */
router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const inboxes = await prisma.inbox.findMany({
      where: { organizationId: req.organizationId },
      include: {
        _count: {
          select: {
            conversations: true,
          },
        },
      },
    });

    const enrichedInboxes = inboxes.map((inbox) => ({
      ...inbox,
      embedSnippet: `<script src="${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/widget.js" data-inbox-key="${inbox.inboxKey}" async></script>`,
    }));

    res.json({ inboxes: enrichedInboxes });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * POST /api/v1/inboxes
 */
router.post('/', requireRoles(['OWNER', 'ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, channelType, widgetColor, greeting } = req.body;

    if (!name) {
      res.status(400).json({ error: 'Bad Request', message: 'Inbox name is required' });
      return;
    }

    const inboxKey = `inbox_${crypto.randomBytes(6).toString('hex')}`;

    const inbox = await prisma.inbox.create({
      data: {
        organizationId: req.organizationId!,
        name,
        channelType: channelType || 'WEB_WIDGET',
        inboxKey,
        widgetColor: widgetColor || '#2563EB',
        greeting: greeting || 'Hello! How can we help you?',
      },
    });

    res.status(201).json({ inbox, message: 'Inbox created successfully' });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

export default router;
