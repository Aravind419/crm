import { Router, Response } from 'express';
import { prisma } from '../prisma';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { tenantIsolationGuard } from '../middleware/tenant';
import { broadcastToOrg, broadcastToConversation } from '../services/socket.service';

const router = Router();

router.use(authMiddleware);
router.use(tenantIsolationGuard);

/**
 * GET /api/v1/conversations
 * Query conversations with filters: status, scope, search
 */
router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { status, scope, search } = req.query;
    const organizationId = req.organizationId!;
    const userId = req.user!.id;

    const whereClause: any = {
      organizationId,
    };

    if (status) {
      whereClause.status = String(status).toUpperCase();
    }

    if (scope === 'mine') {
      whereClause.assigneeId = userId;
    } else if (scope === 'unassigned') {
      whereClause.assigneeId = null;
    }

    if (search && String(search).trim()) {
      const q = String(search).trim();
      whereClause.OR = [
        { customer: { name: { contains: q } } },
        { customer: { email: { contains: q } } },
        { messages: { some: { content: { contains: q } } } },
      ];
    }

    const conversations = await prisma.conversation.findMany({
      where: whereClause,
      include: {
        customer: true,
        assignee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatarUrl: true,
          },
        },
        team: true,
        inbox: {
          select: {
            id: true,
            name: true,
            channelType: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1, // Preview latest message
        },
        tickets: {
          select: {
            id: true,
            ticketNumber: true,
            title: true,
            status: true,
            priority: true,
          },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
    });

    res.json({ conversations });
  } catch (err: any) {
    console.error('[Conversations List Error]:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * GET /api/v1/conversations/:id
 * Retrieve full conversation thread with all messages and customer context.
 */
router.get('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const conversationId = String(req.params.id);
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        organizationId: req.organizationId!,
      },
      include: {
        customer: true,
        assignee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatarUrl: true,
            isAvailable: true,
          },
        },
        team: true,
        inbox: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            attachments: true,
          },
        },
        tickets: {
          include: {
            assignee: {
              select: { firstName: true, lastName: true },
            },
          },
        },
      },
    });

    if (!conversation) {
      res.status(404).json({ error: 'Not Found', message: 'Conversation not found' });
      return;
    }

    res.json({ conversation });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * POST /api/v1/conversations/:id/messages
 * Send agent reply or internal note.
 */
router.post('/:id/messages', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { content, messageType } = req.body;
    const conversationId = String(req.params.id);
    const organizationId = req.organizationId!;
    const user = req.user!;

    if (!content || !content.trim()) {
      res.status(400).json({ error: 'Bad Request', message: 'Message content cannot be empty' });
      return;
    }

    // Verify conversation belongs to tenant
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, organizationId },
    });

    if (!conversation) {
      res.status(404).json({ error: 'Not Found', message: 'Conversation not found' });
      return;
    }

    const type = messageType === 'INTERNAL_NOTE' ? 'INTERNAL_NOTE' : 'PUBLIC_REPLY';

    // Create message & update conversation timestamp in transaction
    const message = await prisma.$transaction(async (tx) => {
      const msg = await tx.message.create({
        data: {
          organizationId,
          conversationId,
          senderType: 'AGENT',
          senderId: user.id,
          senderName: `${user.firstName} ${user.lastName}`,
          messageType: type,
          content: content.trim(),
        },
        include: {
          attachments: true,
        },
      });

      // If public reply and this is first response, record firstResponseAt
      const updateData: any = {
        lastMessageAt: new Date(),
      };

      if (type === 'PUBLIC_REPLY' && !conversation.firstResponseAt) {
        updateData.firstResponseAt = new Date();
      }

      await tx.conversation.update({
        where: { id: conversationId },
        data: updateData,
      });

      return msg;
    });

    // Real-time broadcasts
    broadcastToConversation(conversationId, 'message:created', message);
    broadcastToOrg(organizationId, 'message:created', message);

    res.status(201).json({ message });
  } catch (err: any) {
    console.error('[Post Message Error]:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * PATCH /api/v1/conversations/:id
 * Update status, assignee, team, or priority.
 */
router.patch('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { status, assigneeId, teamId, priority } = req.body;
    const conversationId = String(req.params.id);
    const organizationId = req.organizationId!;

    const existing = await prisma.conversation.findFirst({
      where: { id: conversationId, organizationId },
    });

    if (!existing) {
      res.status(404).json({ error: 'Not Found', message: 'Conversation not found' });
      return;
    }

    const updateData: any = {};
    if (status) {
      updateData.status = status.toUpperCase();
      if (status.toUpperCase() === 'RESOLVED' && !existing.resolvedAt) {
        updateData.resolvedAt = new Date();
      } else if (status.toUpperCase() === 'OPEN') {
        updateData.resolvedAt = null;
      }
    }
    if (assigneeId !== undefined) {
      updateData.assigneeId = assigneeId || null;
    }
    if (teamId !== undefined) {
      updateData.teamId = teamId || null;
    }
    if (priority) {
      updateData.priority = priority.toUpperCase();
    }

    const updated = await prisma.conversation.update({
      where: { id: conversationId },
      data: updateData,
      include: {
        customer: true,
        assignee: true,
        team: true,
      },
    });

    broadcastToConversation(conversationId, 'conversation:updated', updated);
    broadcastToOrg(organizationId, 'conversation:updated', updated);

    res.json({ conversation: updated, message: 'Conversation updated successfully' });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

export default router;
