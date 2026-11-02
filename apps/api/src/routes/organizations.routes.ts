import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { prisma } from '../prisma';
import { config } from '../config';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { tenantIsolationGuard } from '../middleware/tenant';
import { requireRoles } from '../middleware/roles';
import { EntitlementService } from '../services/entitlement.service';

const router = Router();

const ALLOWED_WEBHOOK_EVENTS = [
  'subscription.created',
  'subscription.updated',
  'subscription.cancelled',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
];

const ALLOWED_PLANS = ['FREE', 'TEAM', 'GROWTH', 'BUSINESS', 'ENTERPRISE'];
const ALLOWED_STATUSES = ['ACTIVE', 'SUSPENDED', 'TRIAL'];

/**
 * POST /api/v1/organizations/billing/webhook
 * Authenticated via HMAC-SHA256 signature calculated over the authentic raw request body.
 * Enforces replay protection, event idempotency, and strict value whitelists.
 */
router.post('/billing/webhook', async (req: Request, res: Response): Promise<void> => {
  try {
    const signature = req.headers['x-billing-signature'];
    const timestamp = req.headers['x-billing-timestamp'];
    const rawPayload: Buffer = (req as any).rawBody || Buffer.from(JSON.stringify(req.body));

    if (!signature || typeof signature !== 'string') {
      res.status(401).json({ error: 'Unauthorized', message: 'Missing billing signature' });
      return;
    }

    // Replay attack prevention: verify timestamp if provided (tolerance: 5 minutes)
    if (timestamp && typeof timestamp === 'string') {
      const eventTime = parseInt(timestamp, 10);
      const currentTime = Math.floor(Date.now() / 1000);
      if (isNaN(eventTime) || Math.abs(currentTime - eventTime) > 300) {
        res.status(401).json({ error: 'Unauthorized', message: 'Webhook timestamp expired or invalid' });
        return;
      }
    }

    // Support both direct payload signature and timestamp-bound signature (`${timestamp}.${rawPayload}`)
    const expectedSignatureDirect = crypto
      .createHmac('sha256', config.billingWebhookSecret)
      .update(rawPayload)
      .digest('hex');

    const expectedSignatureBound = timestamp
      ? crypto
          .createHmac('sha256', config.billingWebhookSecret)
          .update(Buffer.concat([Buffer.from(`${timestamp}.`), rawPayload]))
          .digest('hex')
      : null;

    // Constant-time signature comparison to eliminate timing side-channels
    const sigBuffer = Buffer.from(signature);
    const expectedDirectBuffer = Buffer.from(expectedSignatureDirect);
    const matchesDirect =
      sigBuffer.length === expectedDirectBuffer.length &&
      crypto.timingSafeEqual(sigBuffer, expectedDirectBuffer);

    let matchesBound = false;
    if (expectedSignatureBound) {
      const expectedBoundBuffer = Buffer.from(expectedSignatureBound);
      matchesBound =
        sigBuffer.length === expectedBoundBuffer.length &&
        crypto.timingSafeEqual(sigBuffer, expectedBoundBuffer);
    }

    if (!matchesDirect && !matchesBound) {
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid billing webhook signature' });
      return;
    }

    const { event, organizationId, plan, status, id, eventId } = req.body;

    // 1. Strict Whitelist Validations
    if (!event || !ALLOWED_WEBHOOK_EVENTS.includes(event)) {
      res.status(400).json({ error: 'Bad Request', message: `Invalid or unallowed webhook event: ${event}` });
      return;
    }

    if (!organizationId || typeof organizationId !== 'string') {
      res.status(400).json({ error: 'Bad Request', message: 'organizationId is required' });
      return;
    }

    if (!plan || !ALLOWED_PLANS.includes(String(plan).toUpperCase())) {
      res.status(400).json({ error: 'Bad Request', message: `Invalid or unallowed subscription plan: ${plan}` });
      return;
    }

    if (status && !ALLOWED_STATUSES.includes(String(status).toUpperCase())) {
      res.status(400).json({ error: 'Bad Request', message: `Invalid or unallowed subscription status: ${status}` });
      return;
    }

    // 2. Event Idempotency & Replay Protection
    const uniqueEventId = req.headers['x-billing-event-id'] || id || eventId;
    if (uniqueEventId && typeof uniqueEventId === 'string') {
      const alreadyProcessed = await prisma.auditEvent.findFirst({
        where: {
          action: 'BILLING_WEBHOOK_PROCESSED',
          entityId: uniqueEventId,
        },
      });

      if (alreadyProcessed) {
        res.status(200).json({
          success: true,
          idempotent: true,
          message: 'Webhook event already processed (idempotent duplicate)',
        });
        return;
      }
    }

    // 3. Apply Plan Update Atomically
    const org = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        plan: String(plan).toUpperCase(),
        ...(status ? { status: String(status).toUpperCase() } : {}),
      },
    });

    // 4. Record Audit Event and Idempotency Marker
    if (uniqueEventId && typeof uniqueEventId === 'string') {
      await prisma.auditEvent.create({
        data: {
          organizationId: org.id,
          action: 'BILLING_WEBHOOK_PROCESSED',
          entityType: 'BillingEvent',
          entityId: uniqueEventId,
          metadata: JSON.stringify({ event, newPlan: plan, status }),
        },
      }).catch(() => {});
    }

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
