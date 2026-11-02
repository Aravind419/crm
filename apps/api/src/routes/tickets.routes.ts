import { Router, Response } from 'express';
import { prisma } from '../prisma';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { tenantIsolationGuard } from '../middleware/tenant';
import { broadcastToOrg } from '../services/socket.service';

const router = Router();

router.use(authMiddleware);
router.use(tenantIsolationGuard);

/**
 * GET /api/v1/tickets
 * List tickets for organization.
 */
router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { status, priority, search } = req.query;
    const organizationId = req.organizationId!;

    const whereClause: any = { organizationId };

    if (status) whereClause.status = String(status).toUpperCase();
    if (priority) whereClause.priority = String(priority).toUpperCase();
    if (search && String(search).trim()) {
      const q = String(search).trim();
      whereClause.OR = [
        { title: { contains: q } },
        { customer: { name: { contains: q } } },
        { customer: { email: { contains: q } } },
      ];
    }

    const tickets = await prisma.ticket.findMany({
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
        conversation: {
          select: {
            id: true,
            status: true,
          },
        },
      },
      orderBy: { ticketNumber: 'desc' },
    });

    res.json({ tickets });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to retrieve tickets' });
  }
});

/**
 * POST /api/v1/tickets
 * Create a new ticket (escalated from conversation or standalone).
 * ENFORCES: Cross-tenant foreign key defenses for customer, assignee, team, and conversation.
 */
router.post('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { conversationId, customerId, title, description, priority, assigneeId, teamId, dueAt } = req.body;
    const organizationId = req.organizationId!;

    if (!title || !description || !customerId) {
      res.status(400).json({ error: 'Bad Request', message: 'Title, description, and customerId are required' });
      return;
    }

    // Tenant Isolation Check 1: Verify customer belongs to this organization
    const customer = await prisma.customer.findFirst({
      where: { id: String(customerId), organizationId },
    });
    if (!customer) {
      res.status(400).json({ error: 'Bad Request', message: 'Customer does not belong to your organization' });
      return;
    }

    // Tenant Isolation Check 2: Verify assignee belongs to this organization
    if (assigneeId) {
      const assignee = await prisma.user.findFirst({
        where: { id: String(assigneeId), organizationId },
      });
      if (!assignee) {
        res.status(400).json({ error: 'Bad Request', message: 'Assignee does not belong to your organization' });
        return;
      }
    }

    // Tenant Isolation Check 3: Verify team belongs to this organization
    if (teamId) {
      const team = await prisma.team.findFirst({
        where: { id: String(teamId), organizationId },
      });
      if (!team) {
        res.status(400).json({ error: 'Bad Request', message: 'Team does not belong to your organization' });
        return;
      }
    }

    // Tenant Isolation Check 4: Verify conversation belongs to this organization
    if (conversationId) {
      const conv = await prisma.conversation.findFirst({
        where: { id: String(conversationId), organizationId },
      });
      if (!conv) {
        res.status(400).json({ error: 'Bad Request', message: 'Conversation does not belong to your organization' });
        return;
      }
    }

    // Atomic auto-increment ticket number per organization
    const result = await prisma.$transaction(async (tx) => {
      const lastTicket = await tx.ticket.findFirst({
        where: { organizationId },
        orderBy: { ticketNumber: 'desc' },
        select: { ticketNumber: true },
      });

      const nextTicketNumber = (lastTicket?.ticketNumber || 1000) + 1;

      const ticket = await tx.ticket.create({
        data: {
          ticketNumber: nextTicketNumber,
          organizationId,
          conversationId: conversationId ? String(conversationId) : null,
          customerId: String(customerId),
          assigneeId: assigneeId ? String(assigneeId) : null,
          teamId: teamId ? String(teamId) : null,
          title: String(title),
          description: String(description),
          priority: (priority ? String(priority).toUpperCase() : 'MEDIUM') as any,
          status: 'NEW' as any,
          dueAt: dueAt ? new Date(dueAt) : null,
        },
        include: {
          customer: true,
          assignee: true,
          team: true,
        },
      });

      return ticket;
    });

    broadcastToOrg(organizationId, 'ticket:created', result);

    res.status(201).json({ ticket: result, message: `Ticket #${result.ticketNumber} created` });
  } catch (err: any) {
    console.error('[Create Ticket Error]:', err);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to create ticket' });
  }
});

/**
 * GET /api/v1/tickets/:id
 */
router.get('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const ticketId = String(req.params.id);
    const ticket = await prisma.ticket.findFirst({
      where: {
        id: ticketId,
        organizationId: req.organizationId!,
      },
      include: {
        customer: true,
        assignee: true,
        team: true,
        conversation: {
          include: {
            messages: {
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        comments: {
          include: {
            user: {
              select: { firstName: true, lastName: true, avatarUrl: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!ticket) {
      res.status(404).json({ error: 'Not Found', message: 'Ticket not found' });
      return;
    }

    res.json({ ticket });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to retrieve ticket' });
  }
});

/**
 * PATCH /api/v1/tickets/:id
 * ENFORCES: Tenant boundary check for ticket and all updated foreign keys.
 */
router.patch('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const ticketId = String(req.params.id);
    const { status, priority, assigneeId, teamId, dueAt } = req.body;
    const organizationId = req.organizationId!;

    const existing = await prisma.ticket.findFirst({
      where: { id: ticketId, organizationId },
    });

    if (!existing) {
      res.status(404).json({ error: 'Not Found', message: 'Ticket not found' });
      return;
    }

    // Verify foreign keys if being updated
    if (assigneeId !== undefined && assigneeId !== null && assigneeId !== '') {
      const assignee = await prisma.user.findFirst({
        where: { id: String(assigneeId), organizationId },
      });
      if (!assignee) {
        res.status(400).json({ error: 'Bad Request', message: 'Assignee does not belong to your organization' });
        return;
      }
    }

    if (teamId !== undefined && teamId !== null && teamId !== '') {
      const team = await prisma.team.findFirst({
        where: { id: String(teamId), organizationId },
      });
      if (!team) {
        res.status(400).json({ error: 'Bad Request', message: 'Team does not belong to your organization' });
        return;
      }
    }

    const updateData: any = {};
    if (status) {
      updateData.status = String(status).toUpperCase();
      if (updateData.status === 'RESOLVED' && !existing.resolvedAt) {
        updateData.resolvedAt = new Date();
      }
    }
    if (priority) updateData.priority = String(priority).toUpperCase();
    if (assigneeId !== undefined) updateData.assigneeId = assigneeId ? String(assigneeId) : null;
    if (teamId !== undefined) updateData.teamId = teamId ? String(teamId) : null;
    if (dueAt !== undefined) updateData.dueAt = dueAt ? new Date(dueAt) : null;

    const updated = await prisma.ticket.update({
      where: { id: ticketId },
      data: updateData,
      include: {
        customer: true,
        assignee: true,
        team: true,
      },
    });

    broadcastToOrg(organizationId, 'ticket:updated', updated);

    res.json({ ticket: updated, message: 'Ticket updated successfully' });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update ticket' });
  }
});

export default router;
