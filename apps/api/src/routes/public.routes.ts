import { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import { prisma } from '../prisma';
import { rateLimiter } from '../middleware/rate-limiter';
import { broadcastToOrg, broadcastToConversation, disconnectVisitorSockets } from '../services/socket.service';
import { evaluateAutomationRules } from '../services/automation.engine';

const router = Router();

// Rate limit public endpoints to 120 req/min per IP
router.use(rateLimiter({ windowMs: 60 * 1000, max: 120 }));

/**
 * Extracts visitor token from request headers, query string, or request body.
 */
export function extractVisitorToken(req: Request): string | null {
  const headerToken = req.headers['x-visitor-token'];
  if (headerToken && typeof headerToken === 'string' && headerToken.trim()) {
    return headerToken.trim();
  }
  const queryToken = req.query.visitorToken;
  if (queryToken && typeof queryToken === 'string' && queryToken.trim()) {
    return queryToken.trim();
  }
  const bodyToken = req.body?.visitorToken;
  if (bodyToken && typeof bodyToken === 'string' && bodyToken.trim()) {
    return bodyToken.trim();
  }
  return null;
}

/**
 * Cryptographic verification for public visitor session tokens.
 * Verifies existence, expiration, revocation, and exact conversation binding.
 */
export async function verifyVisitorSession(
  rawToken: string | null,
  conversationId: string
): Promise<{ valid: boolean; statusCode: number; error?: string }> {
  if (!rawToken || !rawToken.trim()) {
    return {
      valid: false,
      statusCode: 403,
      error: 'Visitor authentication token required. Provide valid x-visitor-token header.',
    };
  }

  if (!conversationId || typeof conversationId !== 'string' || !conversationId.trim()) {
    return {
      valid: false,
      statusCode: 403,
      error: 'Valid conversation ID binding required.',
    };
  }

  const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');

  // Query database strictly for authoritative VisitorSession record by tokenHash
  const session = await prisma.visitorSession.findFirst({
    where: { tokenHash },
    select: {
      id: true,
      conversationId: true,
      expiresAt: true,
      revokedAt: true,
    },
  });

  if (!session) {
    return {
      valid: false,
      statusCode: 403,
      error: 'Invalid visitor session token. Unauthorized conversation access prohibited.',
    };
  }

  if (session.revokedAt) {
    return { valid: false, statusCode: 403, error: 'Visitor session has been revoked' };
  }

  if (session.expiresAt < new Date()) {
    return { valid: false, statusCode: 403, error: 'Visitor session expired' };
  }

  // Exact conversation ID matching: null or mismatched conversationId strictly denied
  if (!session.conversationId || session.conversationId !== conversationId.trim()) {
    return { valid: false, statusCode: 403, error: 'Visitor session does not match requested conversation' };
  }

  return { valid: true, statusCode: 200 };
}

/**
 * GET /api/v1/public/inbox-config/:inboxKey
 */
router.get('/inbox-config/:inboxKey', async (req: Request, res: Response): Promise<void> => {
  try {
    const inboxKey = String(req.params.inboxKey);
    const inbox = await prisma.inbox.findUnique({
      where: { inboxKey },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    if (!inbox) {
      res.status(404).json({ error: 'Not Found', message: 'Invalid or deactivated inbox key' });
      return;
    }

    res.json({
      inbox: {
        id: inbox.id,
        name: inbox.name,
        widgetColor: inbox.widgetColor,
        greeting: inbox.greeting,
        organizationName: inbox.organization.name,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to retrieve inbox configuration' });
  }
});

/**
 * POST /api/v1/public/conversations
 * Initiates a new conversation from the web widget.
 * Issues a cryptographically secure visitor session token.
 */
router.post('/conversations', async (req: Request, res: Response): Promise<void> => {
  try {
    const { inboxKey, visitorToken, name, email, message } = req.body;

    if (!inboxKey || !message || !String(message).trim()) {
      res.status(400).json({ error: 'Bad Request', message: 'inboxKey and message are required' });
      return;
    }

    const inbox = await prisma.inbox.findUnique({
      where: { inboxKey: String(inboxKey) },
      include: { organization: true },
    });

    if (!inbox) {
      res.status(404).json({ error: 'Not Found', message: 'Inbox not found' });
      return;
    }

    const organizationId = inbox.organizationId;
    const customerEmail = email ? String(email).toLowerCase().trim() : null;
    const customerName = (name && String(name).trim()) || 'Website Visitor';

    // Server-enforced cryptographic 256-bit visitor token generation
    const safeVisitorToken = `vst_${crypto.randomBytes(32).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(safeVisitorToken).digest('hex');
    const sessionExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    // Atomic transaction
    const { conversation, createdMessage } = await prisma.$transaction(async (tx) => {
      let customer = customerEmail
        ? await tx.customer.findFirst({
            where: { organizationId, email: customerEmail },
          })
        : null;

      if (!customer) {
        customer = await tx.customer.create({
          data: {
            organizationId,
            name: customerName,
            email: customerEmail,
            customAttributes: JSON.stringify({
              source: 'Website Widget',
              userAgent: req.headers['user-agent'] || 'unknown',
            }),
          },
        });
      } else {
        try {
          const rawAttrs = customer.customAttributes;
          const existingAttrs =
            typeof rawAttrs === 'string'
              ? JSON.parse(rawAttrs)
              : (rawAttrs as any) || {};
          delete existingAttrs.visitorToken; // Scrub any legacy token
          await tx.customer.update({
            where: { id: customer.id },
            data: { customAttributes: typeof rawAttrs === 'string' ? JSON.stringify(existingAttrs) : existingAttrs },
          });
        } catch (e) {}
      }

      const conv = await tx.conversation.create({
        data: {
          organizationId,
          workspaceId: inbox.workspaceId,
          inboxId: inbox.id,
          customerId: customer.id,
          status: 'OPEN',
          priority: 'MEDIUM',
          lastMessageAt: new Date(),
        },
        include: {
          customer: true,
          inbox: true,
        },
      });

      // Persist cryptographically hashed visitor session
      await tx.visitorSession.create({
        data: {
          inboxId: inbox.id,
          customerId: customer.id,
          conversationId: conv.id,
          tokenHash,
          expiresAt: sessionExpiresAt,
        },
      });

      const msg = await tx.message.create({
        data: {
          organizationId,
          conversationId: conv.id,
          senderType: 'CUSTOMER',
          senderId: customer.id,
          senderName: customer.name,
          messageType: 'PUBLIC_REPLY',
          content: String(message).trim(),
        },
      });

      return { conversation: conv, createdMessage: msg };
    });

    broadcastToOrg(organizationId, 'conversation:created', conversation);
    broadcastToOrg(organizationId, 'message:created', createdMessage);

    evaluateAutomationRules(organizationId, 'conversation.created', {
      conversationId: conversation.id,
      messageContent: String(message).trim(),
      customerEmail: customerEmail || undefined,
    });

    res.status(201).json({
      conversationId: conversation.id,
      customerId: conversation.customerId,
      visitorToken: safeVisitorToken,
      message: createdMessage,
    });
  } catch (err: any) {
    console.error('[Public Conversation Create Error]:', err);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to create conversation' });
  }
});

/**
 * GET /api/v1/public/conversations/:conversationId
 * Visitor fetches conversation message stream.
 * ENFORCES: Cryptographically verified visitor session token.
 */
router.get('/conversations/:conversationId', async (req: Request, res: Response): Promise<void> => {
  try {
    const conversationId = String(req.params.conversationId);
    const visitorToken = extractVisitorToken(req);

    // Verify visitor authorization
    const authCheck = await verifyVisitorSession(visitorToken, conversationId);
    if (!authCheck.valid) {
      res.status(authCheck.statusCode).json({
        error: 'Forbidden',
        message: authCheck.error,
      });
      return;
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        customer: true,
        inbox: {
          select: {
            name: true,
            widgetColor: true,
            greeting: true,
          },
        },
        messages: {
          where: { messageType: 'PUBLIC_REPLY' }, // CRITICAL PRIVACY DEFENSE: Never leak INTERNAL_NOTE
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            senderType: true,
            senderName: true,
            content: true,
            createdAt: true,
          },
        },
      },
    });

    if (!conversation) {
      res.status(404).json({ error: 'Not Found', message: 'Conversation not found' });
      return;
    }

    res.json({
      conversation: {
        id: conversation.id,
        status: conversation.status,
        inbox: conversation.inbox,
        messages: conversation.messages,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to retrieve conversation stream' });
  }
});

/**
 * POST /api/v1/public/conversations/:conversationId/messages
 * Visitor sends follow-up message from widget.
 * ENFORCES: Cryptographically verified visitor session token.
 */
router.post('/conversations/:conversationId/messages', async (req: Request, res: Response): Promise<void> => {
  try {
    const { message, senderName } = req.body;
    const conversationId = String(req.params.conversationId);
    const visitorToken = extractVisitorToken(req);

    if (!message || !String(message).trim()) {
      res.status(400).json({ error: 'Bad Request', message: 'Message content is required' });
      return;
    }

    // Verify visitor authorization
    const authCheck = await verifyVisitorSession(visitorToken, conversationId);
    if (!authCheck.valid) {
      res.status(authCheck.statusCode).json({
        error: 'Forbidden',
        message: authCheck.error,
      });
      return;
    }

    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { customer: true },
    });

    if (!conv) {
      res.status(404).json({ error: 'Not Found', message: 'Conversation not found' });
      return;
    }

    const created = await prisma.$transaction(async (tx) => {
      const msg = await tx.message.create({
        data: {
          organizationId: conv.organizationId,
          conversationId,
          senderType: 'CUSTOMER',
          senderId: conv.customerId,
          senderName: senderName || conv.customer.name || 'Website Visitor',
          messageType: 'PUBLIC_REPLY',
          content: String(message).trim(),
        },
      });

      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          status: 'OPEN',
          lastMessageAt: new Date(),
        },
      });

      return msg;
    });

    // Broadcast only public reply
    broadcastToConversation(conversationId, 'message:created', created);
    broadcastToOrg(conv.organizationId, 'message:created', created);

    res.status(201).json({ message: created });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to post message' });
  }
});

/**
 * POST /api/v1/public/sessions/revoke
 * Explicitly revokes a visitor session token.
 */
router.post('/sessions/revoke', async (req: Request, res: Response): Promise<void> => {
  try {
    const visitorToken = extractVisitorToken(req);
    if (!visitorToken) {
      res.status(400).json({ error: 'Bad Request', message: 'visitorToken is required' });
      return;
    }

    const tokenHash = crypto.createHash('sha256').update(visitorToken.trim()).digest('hex');
    await prisma.visitorSession.updateMany({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });

    // Real-time disconnection: Immediately sever any active WebSocket connections bound to this revoked session
    disconnectVisitorSockets(tokenHash);

    res.json({ message: 'Visitor session revoked successfully' });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to revoke visitor session' });
  }
});

/**
 * GET /api/v1/public/portal/:orgSlug
 */
router.get('/portal/:orgSlug', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgSlug = String(req.params.orgSlug);
    const { search } = req.query;
    const org = await prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true, name: true, slug: true },
    });

    if (!org) {
      res.status(404).json({ error: 'Not Found', message: 'Help center not found' });
      return;
    }

    const whereClause: any = {
      organizationId: org.id,
      status: 'PUBLISHED',
    };

    if (search && String(search).trim()) {
      const q = String(search).trim();
      whereClause.OR = [
        { title: { contains: q } },
        { content: { contains: q } },
      ];
    }

    const categories = await prisma.category.findMany({
      where: { organizationId: org.id },
      include: {
        articles: {
          where: whereClause,
          select: {
            id: true,
            title: true,
            slug: true,
            viewCount: true,
            updatedAt: true,
          },
        },
      },
      orderBy: { orderIndex: 'asc' },
    });

    res.json({
      organization: org,
      categories: categories.filter((c) => c.articles.length > 0 || !search),
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to retrieve help center portal' });
  }
});

/**
 * GET /api/v1/public/portal/:orgSlug/articles/:articleSlug
 */
router.get('/portal/:orgSlug/articles/:articleSlug', async (req: Request, res: Response): Promise<void> => {
  try {
    const orgSlug = String(req.params.orgSlug);
    const articleSlug = String(req.params.articleSlug);

    const org = await prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true, name: true, slug: true },
    });

    if (!org) {
      res.status(404).json({ error: 'Not Found', message: 'Help center not found' });
      return;
    }

    const article = await prisma.article.findFirst({
      where: {
        organizationId: org.id,
        slug: articleSlug,
        status: 'PUBLISHED',
      },
      include: {
        category: true,
        author: {
          select: { firstName: true, lastName: true },
        },
      },
    });

    if (!article) {
      res.status(404).json({ error: 'Not Found', message: 'Article not found' });
      return;
    }

    await prisma.article.update({
      where: { id: article.id },
      data: { viewCount: { increment: 1 } },
    });

    res.json({ article, organization: org });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to retrieve article' });
  }
});

export default router;
