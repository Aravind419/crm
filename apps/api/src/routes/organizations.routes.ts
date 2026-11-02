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
 * Strict Webhook Protocol Verification:
 * 1. Requires authentic raw request bytes (no JSON re-serialization fallback).
 * 2. Requires mandatory x-billing-timestamp header within 300-second tolerance.
 * 3. Requires mandatory unique event ID (x-billing-event-id or event ID).
 * 4. Strict canonical HMAC-SHA256 signature verification over `${timestamp}.${rawPayload}` (no direct-payload fallback).
 * 5. Atomic database transaction updating organization plan, audit log, and WebhookEvent idempotency record.
 * 6. Handles concurrent duplicate deliveries safely via unique constraint and never swallows database failures.
 */
router.post('/billing/webhook', async (req: Request, res: Response): Promise<void> => {
  try {
    const signature = req.headers['x-billing-signature'];
    const timestamp = req.headers['x-billing-timestamp'];
    const rawPayload: Buffer | undefined = (req as any).rawBody;

    // Requirement 3: Authentic raw request bytes are MANDATORY
    if (!rawPayload || !Buffer.isBuffer(rawPayload) || rawPayload.length === 0) {
      res.status(400).json({ error: 'Bad Request', message: 'Authentic raw request body required for webhook verification' });
      return;
    }

    // Requirement 1 & 4: Timestamp is MANDATORY
    if (!timestamp || typeof timestamp !== 'string') {
      res.status(400).json({ error: 'Bad Request', message: 'Missing required x-billing-timestamp header' });
      return;
    }

    const eventTime = parseInt(timestamp, 10);
    const currentTime = Math.floor(Date.now() / 1000);
    if (isNaN(eventTime)) {
      res.status(400).json({ error: 'Bad Request', message: 'Malformed x-billing-timestamp header' });
      return;
    }

    // Requirement 5: Reject requests older than tolerance window (300 seconds / 5 minutes)
    if (Math.abs(currentTime - eventTime) > 300) {
      res.status(401).json({ error: 'Unauthorized', message: 'Webhook timestamp expired or outside tolerance window' });
      return;
    }

    if (!signature || typeof signature !== 'string') {
      res.status(401).json({ error: 'Unauthorized', message: 'Missing billing signature' });
      return;
    }

    // Requirement 6 & 7: Verify signature STRICTLY over canonical timestamp-plus-payload format.
    // Direct payload signature is NOT accepted as a fallback.
    const expectedSignature = crypto
      .createHmac('sha256', config.billingWebhookSecret)
      .update(Buffer.concat([Buffer.from(`${timestamp}.`), rawPayload]))
      .digest('hex');

    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid billing webhook signature' });
      return;
    }

    const { event, organizationId, plan, status, id, eventId } = req.body;

    // Requirement 2: Unique event ID is MANDATORY
    const uniqueEventId = req.headers['x-billing-event-id'] || id || eventId;
    if (!uniqueEventId || typeof uniqueEventId !== 'string' || !uniqueEventId.trim()) {
      res.status(400).json({ error: 'Bad Request', message: 'Unique event identifier (x-billing-event-id or event ID) is required' });
      return;
    }

    // Strict Whitelist Validations
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

    // Requirements 8, 9, 10, 11:
    // Atomic Transaction: WebhookEvent unique constraint + Organization Update + AuditEvent creation.
    // Never swallow database failures!
    try {
      await prisma.$transaction(async (tx) => {
        // Record unique webhook event for database-level idempotency
        await tx.webhookEvent.create({
          data: {
            eventId: uniqueEventId.trim(),
            organizationId,
            event,
            status: 'PROCESSED',
          },
        });

        // Apply plan update atomically
        await tx.organization.update({
          where: { id: organizationId },
          data: {
            plan: String(plan).toUpperCase() as any,
            ...(status ? { status: String(status).toUpperCase() as any } : {}),
          },
        });

        // Record audit event in the same transaction
        await tx.auditEvent.create({
          data: {
            organizationId,
            action: 'BILLING_WEBHOOK_PROCESSED',
            entityType: 'BillingEvent',
            entityId: uniqueEventId.trim(),
            metadata: JSON.stringify({ event, newPlan: plan, status }),
          },
        });
      });

      res.json({ success: true, message: `Organization plan successfully updated to ${plan}` });
    } catch (txErr: any) {
      // Prisma unique constraint violation code is P2002
      if (txErr.code === 'P2002' || txErr.message?.includes('Unique constraint failed')) {
        res.status(200).json({
          success: true,
          idempotent: true,
          message: 'Webhook event already processed (idempotent duplicate)',
        });
        return;
      }

      console.error('[Billing Webhook Atomic Processing Error]:', txErr);
      res.status(500).json({ error: 'Internal Server Error', message: 'Database failure during event processing' });
    }
  } catch (err: any) {
    console.error('[Billing Webhook Fatal Error]:', err);
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
