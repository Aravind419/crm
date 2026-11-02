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
        inboxes: true,
        _count: {
          select: {
            users: true,
            inboxes: true,
            teams: true,
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
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
        plan: org.plan,
        status: org.status,
        logoUrl: org.logoUrl,
        brandColor: org.brandColor,
        timezone: org.timezone,
        locale: org.locale,
        businessHours: org.businessHours,
        allowedDomains: org.allowedDomains,
        onboardingCompleted: org.onboardingCompleted,
        onboardingStep: org.onboardingStep,
        createdAt: org.createdAt,
        workspaces: org.workspaces,
        inboxes: org.inboxes,
        _count: org._count,
      },
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
 * Allows updating: name, logoUrl, brandColor, timezone, locale, businessHours, allowedDomains.
 */
router.patch('/current', requireRoles(['OWNER', 'ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, plan, logoUrl, brandColor, timezone, locale, businessHours, allowedDomains } = req.body;

    // Defense: Explicitly reject client plan tampering
    if (plan !== undefined) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Direct subscription plan tampering prohibited. Subscription plans must be modified through verified billing checkouts or signed billing webhooks.',
      });
      return;
    }

    if (name !== undefined && (!name || !String(name).trim())) {
      res.status(400).json({ error: 'Bad Request', message: 'Organization name cannot be empty' });
      return;
    }

    if (brandColor !== undefined && !/^#[0-9A-Fa-f]{6}$/.test(String(brandColor).trim())) {
      res.status(400).json({ error: 'Bad Request', message: 'Brand color must be a valid 6-character hex color (e.g. #2563EB)' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.update({
        where: { id: req.organizationId },
        data: {
          ...(name !== undefined ? { name: String(name).trim() } : {}),
          ...(logoUrl !== undefined ? { logoUrl: logoUrl ? String(logoUrl).trim() : null } : {}),
          ...(brandColor !== undefined ? { brandColor: String(brandColor).trim() } : {}),
          ...(timezone !== undefined ? { timezone: String(timezone).trim() } : {}),
          ...(locale !== undefined ? { locale: String(locale).trim() } : {}),
          ...(businessHours !== undefined
            ? { businessHours: typeof businessHours === 'object' ? JSON.stringify(businessHours) : String(businessHours) }
            : {}),
          ...(allowedDomains !== undefined
            ? { allowedDomains: typeof allowedDomains === 'object' ? JSON.stringify(allowedDomains) : String(allowedDomains) }
            : {}),
        },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: req.organizationId!,
          userId: req.user!.id,
          action: 'ORG_SETTINGS_UPDATED',
          entityType: 'Organization',
          entityId: org.id,
          ipAddress: req.ip || req.socket.remoteAddress || null,
          metadata: JSON.stringify({ name, brandColor, timezone, locale }),
        },
      });

      return org;
    });

    res.json({ organization: updated, message: 'Organization updated successfully' });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update organization' });
  }
});

/**
 * POST /api/v1/organizations/onboarding
 * Step through and complete first-time onboarding wizard.
 */
router.post('/onboarding', requireRoles(['OWNER', 'ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const {
      step,
      companyName,
      logoUrl,
      brandColor,
      timezone,
      locale,
      businessHours,
      allowedDomains,
      workspaceName,
      inboxGreeting,
      widgetColor,
      completed,
    } = req.body;

    const organizationId = req.organizationId!;

    const result = await prisma.$transaction(async (tx) => {
      // 1. Update organization profile
      const updatedOrg = await tx.organization.update({
        where: { id: organizationId },
        data: {
          ...(companyName ? { name: String(companyName).trim() } : {}),
          ...(logoUrl !== undefined ? { logoUrl: logoUrl ? String(logoUrl).trim() : null } : {}),
          ...(brandColor ? { brandColor: String(brandColor).trim() } : {}),
          ...(timezone ? { timezone: String(timezone).trim() } : {}),
          ...(locale ? { locale: String(locale).trim() } : {}),
          ...(businessHours ? { businessHours: typeof businessHours === 'object' ? JSON.stringify(businessHours) : String(businessHours) } : {}),
          ...(allowedDomains ? { allowedDomains: typeof allowedDomains === 'object' ? JSON.stringify(allowedDomains) : String(allowedDomains) } : {}),
          ...(step ? { onboardingStep: parseInt(step, 10) } : {}),
          ...(completed === true ? { onboardingCompleted: true } : {}),
        },
      });

      // 2. Update default workspace name if provided
      if (workspaceName) {
        const primaryWorkspace = await tx.workspace.findFirst({
          where: { organizationId },
          orderBy: { createdAt: 'asc' },
        });
        if (primaryWorkspace) {
          await tx.workspace.update({
            where: { id: primaryWorkspace.id },
            data: { name: String(workspaceName).trim() },
          });
        }
      }

      // 3. Update primary live chat inbox configuration if provided
      if (inboxGreeting || widgetColor) {
        const primaryInbox = await tx.inbox.findFirst({
          where: { organizationId },
          orderBy: { createdAt: 'asc' },
        });
        if (primaryInbox) {
          await tx.inbox.update({
            where: { id: primaryInbox.id },
            data: {
              ...(inboxGreeting ? { greeting: String(inboxGreeting).trim() } : {}),
              ...(widgetColor ? { widgetColor: String(widgetColor).trim() } : {}),
            },
          });
        }
      }

      await tx.auditEvent.create({
        data: {
          organizationId,
          userId: req.user!.id,
          action: completed ? 'ONBOARDING_COMPLETED' : 'ONBOARDING_STEP_SAVED',
          entityType: 'Organization',
          entityId: organizationId,
          ipAddress: req.ip || req.socket.remoteAddress || null,
          metadata: JSON.stringify({ step, completed }),
        },
      });

      return updatedOrg;
    });

    res.json({
      message: completed ? 'Onboarding successfully completed' : 'Onboarding step saved',
      organization: result,
    });
  } catch (err: any) {
    console.error('[Onboarding Error]:', err);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to process onboarding' });
  }
});

/**
 * GET /api/v1/organizations/widget-snippet
 * Generate production-ready widget installation snippet using verified public application URL.
 * NEVER outputs localhost in production.
 */
router.get('/widget-snippet', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const inboxes = await prisma.inbox.findMany({
      where: { organizationId: req.organizationId },
      orderBy: { createdAt: 'asc' },
    });

    const publicUrl = config.appUrl;

    const snippets = inboxes.map((inbox) => ({
      inboxId: inbox.id,
      inboxName: inbox.name,
      inboxKey: inbox.inboxKey,
      widgetColor: inbox.widgetColor,
      greeting: inbox.greeting,
      allowedOrigins: inbox.allowedOrigins,
      snippet: `<script src="${publicUrl}/widget.js" data-inbox-key="${inbox.inboxKey}" async></script>`,
    }));

    res.json({
      publicAppUrl: publicUrl,
      snippets,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to generate widget snippets' });
  }
});

/**
 * PATCH /api/v1/organizations/inboxes/:id
 * Update inbox channel settings (greeting, widget color, allowed website domains).
 */
router.patch('/inboxes/:id', requireRoles(['OWNER', 'ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { name, greeting, widgetColor, allowedOrigins } = req.body;
    const organizationId = req.organizationId!;

    const targetInbox = await prisma.inbox.findFirst({
      where: { id, organizationId },
    });

    if (!targetInbox) {
      res.status(404).json({ error: 'Not Found', message: 'Inbox not found in your organization' });
      return;
    }

    if (widgetColor && !/^#[0-9A-Fa-f]{6}$/.test(String(widgetColor).trim())) {
      res.status(400).json({ error: 'Bad Request', message: 'Widget color must be a valid 6-character hex color (e.g. #2563EB)' });
      return;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const ibx = await tx.inbox.update({
        where: { id: targetInbox.id },
        data: {
          ...(name ? { name: String(name).trim() } : {}),
          ...(greeting ? { greeting: String(greeting).trim() } : {}),
          ...(widgetColor ? { widgetColor: String(widgetColor).trim() } : {}),
          ...(allowedOrigins !== undefined
            ? { allowedOrigins: typeof allowedOrigins === 'object' ? JSON.stringify(allowedOrigins) : String(allowedOrigins).trim() }
            : {}),
        },
      });

      await tx.auditEvent.create({
        data: {
          organizationId,
          userId: req.user!.id,
          action: 'INBOX_UPDATED',
          entityType: 'Inbox',
          entityId: ibx.id,
          ipAddress: req.ip || req.socket.remoteAddress || null,
          metadata: JSON.stringify({ name, greeting, widgetColor, allowedOrigins }),
        },
      });

      return ibx;
    });

    res.json({ inbox: updated, message: 'Inbox updated successfully' });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update inbox' });
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
