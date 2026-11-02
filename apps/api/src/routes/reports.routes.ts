import { Router, Response } from 'express';
import { prisma } from '../prisma';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { tenantIsolationGuard } from '../middleware/tenant';

const router = Router();

router.use(authMiddleware);
router.use(tenantIsolationGuard);

/**
 * GET /api/v1/reports/overview
 * Real-time operational metrics calculated strictly from authoritative database records.
 * Zero fabricated or hardcoded fallback values.
 */
router.get('/overview', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const organizationId = req.organizationId!;

    // 1. Authoritative Conversation Counts
    const totalConversations = await prisma.conversation.count({ where: { organizationId } });
    const openConversations = await prisma.conversation.count({ where: { organizationId, status: 'OPEN' } });
    const pendingConversations = await prisma.conversation.count({ where: { organizationId, status: 'PENDING' } });
    const resolvedConversations = await prisma.conversation.count({ where: { organizationId, status: 'RESOLVED' } });

    // 2. Authoritative Ticket Counts
    const totalTickets = await prisma.ticket.count({ where: { organizationId } });
    const openTickets = await prisma.ticket.count({
      where: { organizationId, status: { in: ['NEW', 'OPEN', 'PENDING'] } },
    });

    // 3. Exact First Response Time Calculation from Real Records
    const respondedConvs = await prisma.conversation.findMany({
      where: {
        organizationId,
        firstResponseAt: { not: null },
      },
      select: {
        createdAt: true,
        firstResponseAt: true,
      },
    });

    let avgFirstResponseMinutes: number | null = null;
    if (respondedConvs.length > 0) {
      const totalMinutes = respondedConvs.reduce((acc, c) => {
        const diffMs = new Date(c.firstResponseAt!).getTime() - new Date(c.createdAt).getTime();
        return acc + Math.max(0, diffMs / (1000 * 60));
      }, 0);
      avgFirstResponseMinutes = Math.round(totalMinutes / respondedConvs.length);
    }

    // 4. Agent Performance from Real Work Assignments
    const agents = await prisma.user.findMany({
      where: { organizationId, status: 'ACTIVE' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        isAvailable: true,
        _count: {
          select: {
            assignedConvs: true,
            assignedTickets: true,
          },
        },
      },
    });

    // 5. Dynamic 7-day Historical Trend Calculated from Database Timestamps
    const now = new Date();
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const volumeTrends = [];

    for (let i = 6; i >= 0; i--) {
      const targetDay = new Date(now);
      targetDay.setDate(targetDay.getDate() - i);
      const startOfDay = new Date(targetDay.getFullYear(), targetDay.getMonth(), targetDay.getDate(), 0, 0, 0);
      const endOfDay = new Date(targetDay.getFullYear(), targetDay.getMonth(), targetDay.getDate(), 23, 59, 59, 999);

      const incoming = await prisma.conversation.count({
        where: {
          organizationId,
          createdAt: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
      });

      const resolved = await prisma.conversation.count({
        where: {
          organizationId,
          resolvedAt: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
      });

      volumeTrends.push({
        day: dayNames[targetDay.getDay()],
        date: startOfDay.toISOString().split('T')[0],
        incoming,
        resolved,
      });
    }

    res.json({
      metrics: {
        totalConversations,
        openConversations,
        pendingConversations,
        resolvedConversations,
        totalTickets,
        openTickets,
        avgFirstResponseMinutes, // null if no conversations have been responded to yet
        customerSatisfactionScore: null, // null until CSAT ratings are collected
        hasSufficientData: totalConversations > 0,
      },
      agents: agents.map((a) => ({
        id: a.id,
        name: `${a.firstName} ${a.lastName}`,
        avatarUrl: a.avatarUrl,
        isAvailable: a.isAvailable,
        assignedConversations: a._count.assignedConvs,
        assignedTickets: a._count.assignedTickets,
      })),
      volumeTrends,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to generate operational report' });
  }
});

export default router;
