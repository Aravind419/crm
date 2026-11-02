import { Router, Response } from 'express';
import { prisma } from '../prisma';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { tenantIsolationGuard, tenantTransactionMiddleware } from '../middleware/tenant';
import { requireRoles } from '../middleware/roles';

const router = Router();

router.use(authMiddleware);
router.use(tenantIsolationGuard);
router.use(tenantTransactionMiddleware);

/**
 * GET /api/v1/teams
 * List all support teams for the organization, including members, leads, and workload counts.
 */
router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const teams = await prisma.team.findMany({
      where: { organizationId: req.organizationId },
      include: {
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatarUrl: true,
            isAvailable: true,
          },
        },
        members: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                role: true,
                avatarUrl: true,
                isAvailable: true,
                status: true,
              },
            },
          },
        },
        _count: {
          select: {
            conversations: true,
            tickets: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const formattedTeams = teams.map((team) => ({
      ...team,
      metrics: {
        conversations: team._count?.conversations || 0,
        tickets: team._count?.tickets || 0,
      },
    }));

    res.json({ teams: formattedTeams });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * POST /api/v1/teams
 * Create a new team with optional lead and member assignments.
 */
router.post('/', requireRoles(['OWNER', 'ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, description, leadId, memberUserIds, memberIds } = req.body;
    const organizationId = req.organizationId!;
    const effectiveMemberIds = (memberUserIds || memberIds) as string[] | undefined;

    if (!name || !String(name).trim()) {
      res.status(400).json({ error: 'Bad Request', message: 'Team name is required' });
      return;
    }

    // Verify leadId belongs to the organization
    if (leadId) {
      const validLead = await prisma.user.findFirst({
        where: { id: String(leadId), organizationId },
      });
      if (!validLead) {
        res.status(400).json({ error: 'Bad Request', message: 'Designated team lead does not belong to your organization' });
        return;
      }
    }

    // Cross-tenant defense: Validate all memberUserIds belong to current organization
    if (effectiveMemberIds && Array.isArray(effectiveMemberIds) && effectiveMemberIds.length > 0) {
      const validUsers = await prisma.user.findMany({
        where: {
          id: { in: effectiveMemberIds },
          organizationId,
        },
        select: { id: true },
      });

      if (validUsers.length !== effectiveMemberIds.length) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'One or more users do not belong to this organization',
        });
        return;
      }
    }

    const team = await prisma.$transaction(async (tx) => {
      const t = await tx.team.create({
        data: {
          organizationId,
          name: String(name).trim(),
          description: description ? String(description).trim() : null,
          leadId: leadId ? String(leadId) : null,
          ...(effectiveMemberIds && Array.isArray(effectiveMemberIds)
            ? {
                members: {
                  create: effectiveMemberIds.map((userId: string) => ({ userId })),
                },
              }
            : {}),
        },
        include: {
          lead: true,
          members: {
            include: {
              user: true,
            },
          },
        },
      });

      await tx.auditEvent.create({
        data: {
          organizationId,
          userId: req.user!.id,
          action: 'TEAM_CREATED',
          entityType: 'Team',
          entityId: t.id,
          ipAddress: req.ip || req.socket.remoteAddress || null,
          metadata: JSON.stringify({ name: t.name, leadId, memberCount: memberUserIds?.length || 0 }),
        },
      });

      return t;
    });

    res.status(201).json({ team, message: 'Team created successfully' });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * PATCH /api/v1/teams/:id
 * Edit team name, description, and team lead.
 */
router.patch('/:id', requireRoles(['OWNER', 'ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { name, description, leadId } = req.body;
    const organizationId = req.organizationId!;

    const existingTeam = await prisma.team.findFirst({
      where: { id, organizationId },
    });

    if (!existingTeam) {
      res.status(404).json({ error: 'Not Found', message: 'Team not found in your organization' });
      return;
    }

    // Verify leadId belongs to organization if provided
    if (leadId !== undefined && leadId !== null && leadId !== '') {
      const validLead = await prisma.user.findFirst({
        where: { id: String(leadId), organizationId },
      });
      if (!validLead) {
        res.status(400).json({ error: 'Bad Request', message: 'Designated team lead does not belong to your organization' });
        return;
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const t = await tx.team.update({
        where: { id: existingTeam.id },
        data: {
          ...(name !== undefined ? { name: String(name).trim() } : {}),
          ...(description !== undefined ? { description: description ? String(description).trim() : null } : {}),
          ...(leadId !== undefined ? { leadId: leadId ? String(leadId) : null } : {}),
        },
        include: {
          lead: true,
          members: {
            include: { user: true },
          },
        },
      });

      await tx.auditEvent.create({
        data: {
          organizationId,
          userId: req.user!.id,
          action: 'TEAM_UPDATED',
          entityType: 'Team',
          entityId: t.id,
          ipAddress: req.ip || req.socket.remoteAddress || null,
          metadata: JSON.stringify({ name: t.name, leadId }),
        },
      });

      return t;
    });

    res.json({ team: updated, message: 'Team updated successfully' });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * DELETE /api/v1/teams/:id
 * Delete a support team. Nullifies team assignments on existing tickets/conversations.
 */
router.delete('/:id', requireRoles(['OWNER', 'ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const organizationId = req.organizationId!;

    const existingTeam = await prisma.team.findFirst({
      where: { id, organizationId },
    });

    if (!existingTeam) {
      res.status(404).json({ error: 'Not Found', message: 'Team not found in your organization' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      // Unlink team from conversations and tickets
      await tx.conversation.updateMany({
        where: { teamId: existingTeam.id },
        data: { teamId: null },
      });

      await tx.ticket.updateMany({
        where: { teamId: existingTeam.id },
        data: { teamId: null },
      });

      // Remove team members
      await tx.teamMember.deleteMany({
        where: { teamId: existingTeam.id },
      });

      // Delete team
      await tx.team.delete({
        where: { id: existingTeam.id },
      });

      await tx.auditEvent.create({
        data: {
          organizationId,
          userId: req.user!.id,
          action: 'TEAM_DELETED',
          entityType: 'Team',
          entityId: existingTeam.id,
          ipAddress: req.ip || req.socket.remoteAddress || null,
          metadata: JSON.stringify({ deletedName: existingTeam.name }),
        },
      });
    });

    res.json({ message: 'Team deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * POST /api/v1/teams/:id/members
 * Add one or more agents to a team.
 */
router.post('/:id/members', requireRoles(['OWNER', 'ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { userIds, userId } = req.body;
    const organizationId = req.organizationId!;

    const targetUserIds: string[] = Array.isArray(userIds) ? userIds : userId ? [userId] : [];
    if (targetUserIds.length === 0) {
      res.status(400).json({ error: 'Bad Request', message: 'One or more userIds are required' });
      return;
    }

    const existingTeam = await prisma.team.findFirst({
      where: { id, organizationId },
    });

    if (!existingTeam) {
      res.status(404).json({ error: 'Not Found', message: 'Team not found in your organization' });
      return;
    }

    // Verify all users belong to organization
    const validUsers = await prisma.user.findMany({
      where: { id: { in: targetUserIds }, organizationId },
      select: { id: true },
    });

    if (validUsers.length !== targetUserIds.length) {
      res.status(400).json({ error: 'Bad Request', message: 'One or more users do not belong to this organization' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      for (const uId of targetUserIds) {
        await tx.teamMember.upsert({
          where: { teamId_userId: { teamId: existingTeam.id, userId: uId } },
          create: { teamId: existingTeam.id, userId: uId },
          update: {},
        });
      }

      await tx.auditEvent.create({
        data: {
          organizationId,
          userId: req.user!.id,
          action: 'TEAM_MEMBERS_ADDED',
          entityType: 'Team',
          entityId: existingTeam.id,
          ipAddress: req.ip || req.socket.remoteAddress || null,
          metadata: JSON.stringify({ addedUserIds: targetUserIds }),
        },
      });
    });

    res.json({ message: 'Team members added successfully' });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * DELETE /api/v1/teams/:id/members/:userId
 * Remove an agent from a team.
 */
router.delete('/:id/members/:userId', requireRoles(['OWNER', 'ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const userId = String(req.params.userId);
    const organizationId = req.organizationId!;

    const existingTeam = await prisma.team.findFirst({
      where: { id, organizationId },
    });

    if (!existingTeam) {
      res.status(404).json({ error: 'Not Found', message: 'Team not found in your organization' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.teamMember.deleteMany({
        where: { teamId: existingTeam.id, userId },
      });

      // If removed user was lead, unset leadId
      if (existingTeam.leadId === userId) {
        await tx.team.update({
          where: { id: existingTeam.id },
          data: { leadId: null },
        });
      }

      await tx.auditEvent.create({
        data: {
          organizationId,
          userId: req.user!.id,
          action: 'TEAM_MEMBER_REMOVED',
          entityType: 'Team',
          entityId: existingTeam.id,
          ipAddress: req.ip || req.socket.remoteAddress || null,
          metadata: JSON.stringify({ removedUserId: userId }),
        },
      });
    });

    res.json({ message: 'Team member removed successfully' });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

export default router;
