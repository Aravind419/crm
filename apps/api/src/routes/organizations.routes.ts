import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { prisma } from '../prisma';
import { config } from '../config';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { tenantIsolationGuard } from '../middleware/tenant';
import { requireRoles } from '../middleware/roles';
import { EntitlementService } from '../services/entitlement.service';

const router = Router();

/**
 * POST /api/v1/organizations/billing/webhook
 * Authenticated via HMAC-SHA256 signature from payment provider.
 */
router.post('/billing/webhook', async (req: Request, res: Response): Promise<void> => {
  try {
    const signature = req.headers['x-billing-signature'];
    const payload = JSON.stringify(req.body);

    if (!signature || typeof signature !== 'string') {
      res.status(401).json({ error: 'Unauthorized', message: 'Missing billing signature' });
      return;
    }

    const expectedSignature = crypto
      .createHmac('sha256', config.billingWebhookSecret)
      .update(payload)
      .digest('hex');

    // Constant-time signature comparison to prevent timing attacks
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid billing webhook signature' });
      return;
    }

    const { event, organizationId, plan, status } = req.body;

    if (!organizationId || !plan) {
      res.status(400).json({ error: 'Bad Request', message: 'Missing required webhook fields' });
      return;
    }

    const org = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        plan: String(plan).toUpperCase(),
        ...(status ? { status: String(status).toUpperCase() } : {}),
      },
    });

    await prisma.auditEvent.create({
      data: {
        organizationId: org.id,
        action: 'PLAN_UPGRADED_VIA_BILLING',
        entityType: 'Organization',
        entityId: org.id,
        metadata: JSON.stringify({ event, newPlan: plan, status }),
      },
    }).catch(() => {});

    res.json({ success: true, message: `Organization plan successfully updated to ${plan}` });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Webhook processing failed' });
  }
});

// Protected routes below
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

    const { limits } = await EntitlementService.getPlanLimits(org.id);

    res.json({
      organization: org,
      subscription: {
        plan: org.plan,
        status: org.status,
        limits,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to retrieve organization' });
  }
});

/**
 * PATCH /api/v1/organizations/current
 * ANTI-TAMPERING DEFENSE: Plan modification is strictly rejected here.
 */
router.patch('/current', requireRoles(['OWNER', 'ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, plan } = req.body;

    // Defense: Explicitly reject client plan tampering
    if (plan !== undefined) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Direct subscription plan tampering prohibited. Subscription plans must be modified through verified billing checkouts or signed billing webhooks.',
      });
      return;
    }

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Bad Request', message: 'Organization name cannot be empty' });
      return;
    }

    const updated = await prisma.organization.update({
      where: { id: req.organizationId },
      data: {
        name: name.trim(),
      },
    });

    res.json({ organization: updated, message: 'Organization updated successfully' });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update organization' });
  }
});

/**
 * GET /api/v1/organizations/limits
 */
router.get('/limits', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { plan, limits } = await EntitlementService.getPlanLimits(req.organizationId!);
    const agentCheck = await EntitlementService.canAddAgent(req.organizationId!);
    const inboxCheck = await EntitlementService.canAddInbox(req.organizationId!);

    res.json({
      plan,
      limits,
      usage: {
        agents: { current: agentCheck.current, max: agentCheck.max, canAdd: agentCheck.allowed },
        inboxes: { current: inboxCheck.current, max: inboxCheck.max, canAdd: inboxCheck.allowed },
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to fetch entitlement limits' });
  }
});

export default router;
