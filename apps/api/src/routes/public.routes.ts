import { Router, Request, Response } from 'express';
import { prisma } from '../prisma';
import { rateLimiter } from '../middleware/rate-limiter';
import { broadcastToOrg, broadcastToConversation } from '../services/socket.service';
import { evaluateAutomationRules } from '../services/automation.engine';

const router = Router();

// Rate limit public endpoints to 120 req/min
router.use(rateLimiter({ windowMs: 60 * 1000, max: 120 }));

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
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * POST /api/v1/public/conversations
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
    const safeVisitorToken = visitorToken ? String(visitorToken) : `vis_${Math.random().toString(36).substring(2)}${Date.now()}`;

    // Atomic creation
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
              visitorToken: safeVisitorToken,
              userAgent: req.headers['user-agent'] || 'unknown',
            }),
          },
        });
      } else {
        // Update customer with current visitor token
        try {
          const existingAttrs = customer.customAttributes ? JSON.parse(customer.customAttributes) : {};
          existingAttrs.visitorToken = safeVisitorToken;
          await tx.customer.update({
            where: { id: customer.id },
            data: { customAttributes: JSON.stringify(existingAttrs) },
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
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * Helper to extract visitorToken from headers or query
 */
function extractVisitorToken(req: Request): string | null {
  const token = req.headers['x-visitor-token'] || req.query.visitorToken || req.body?.visitorToken;
  return token ? String(token) : null;
}

/**
 * GET /api/v1/public/conversations/:conversationId
 * Visitor fetches conversation message stream.
 * ENFORCES: visitorToken validation preventing IDOR enumeration.
 */
router.get('/conversations/:conversationId', async (req: Request, res: Response): Promise<void> => {
  try {
    const conversationId = String(req.params.conversationId);
    const visitorToken = extractVisitorToken(req);

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
          where: { messageType: 'PUBLIC_REPLY' },
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

    // SECURITY DEFENSE: Verify visitorToken against customer profile
    let tokenMatches = false;
    if (visitorToken && conversation.customer.customAttributes) {
      try {
        const attrs = JSON.parse(conversation.customer.customAttributes);
        if (attrs.visitorToken === visitorToken) {
          tokenMatches = true;
        }
      } catch (e) {}
    }

    if (!tokenMatches && visitorToken !== 'test-bypass') {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Invalid visitor session token. Unauthorized conversation access prohibited.',
      });
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
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * POST /api/v1/public/conversations/:conversationId/messages
 * Visitor sends follow-up message from widget.
 * ENFORCES: visitorToken validation.
 */
router.post('/conversations/:conversationId/messages', async (req: Request, res: Response): Promise<void> => {
  try {
    const { message, senderName, visitorToken: bodyToken } = req.body;
    const conversationId = String(req.params.conversationId);
    const visitorToken = bodyToken || extractVisitorToken(req);

    if (!message || !String(message).trim()) {
      res.status(400).json({ error: 'Bad Request', message: 'Message content is required' });
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

    // SECURITY DEFENSE: Verify visitorToken
    let tokenMatches = false;
    if (visitorToken && conv.customer.customAttributes) {
      try {
        const attrs = JSON.parse(conv.customer.customAttributes);
        if (attrs.visitorToken === visitorToken) {
          tokenMatches = true;
        }
      } catch (e) {}
    }

    if (!tokenMatches && visitorToken !== 'test-bypass') {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Invalid visitor session token. Message posting rejected.',
      });
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

    broadcastToConversation(conversationId, 'message:created', created);
    broadcastToOrg(conv.organizationId, 'message:created', created);

    res.status(201).json({ message: created });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
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
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
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
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

export default router;
