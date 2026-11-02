import { Router, Response } from 'express';
import * as crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma';
import { config } from '../config';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { tenantIsolationGuard, tenantTransactionMiddleware } from '../middleware/tenant';
import { requireRoles } from '../middleware/roles';
import { EntitlementService } from '../services/entitlement.service';
import { disconnectUserSockets } from '../services/socket.service';
import { EmailService } from '../services/email.service';

const router = Router();

router.use(authMiddleware);
router.use(tenantIsolationGuard);
router.use(tenantTransactionMiddleware);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * Executes an operation with automatic retry on transient concurrency/serialization conflicts
 * (such as PostgreSQL 40001, SQLite busy/locked, Prisma P2034).
 */
async function withConcurrencyRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      const isTransient =
        err?.code === 'P2034' ||
        err?.code === '40001' ||
        err?.code === '55P03' ||
        (typeof err?.message === 'string' &&
          (err.message.includes('deadlock') ||
            err.message.includes('busy') ||
            err.message.includes('locked') ||
            err.message.includes('could not serialize access')));

      if (isTransient && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 25 * Math.pow(2, attempt) + Math.random() * 25));
        continue;
      }
      throw err;
    }
  }
}

/**
 * GET /api/v1/users
 * List all agents and staff in the organization, including pending invitations.
 */
router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      where: { organizationId: req.organizationId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        isAvailable: true,
        avatarUrl: true,
        invitationExpiresAt: true,
        createdAt: true,
        teamMemberships: {
          include: {
            team: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ users });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to retrieve users' });
  }
});

/**
 * PATCH /api/v1/users/availability
 * Agent toggles their own availability (online/away).
 */
router.patch('/availability', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { isAvailable } = req.body;

    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: { isAvailable: Boolean(isAvailable) },
      select: { id: true, isAvailable: true },
    });

    res.json({ user: updated, message: 'Availability status updated' });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update availability' });
  }
});

/**
 * POST /api/v1/users/invite
 * Admins/Owners invite a new agent to the organization.
 * SECURITY:
 * 1. Cryptographically secure 32-byte single-use token (never stored raw, only SHA-256 hash).
 * 2. Role escalation defense: Admin cannot invite Owner.
 * 3. Never sets a hardcoded default password; account remains in INVITED state until accepted.
 * 4. Enforces subscription seat limit.
 * 5. Dispatches via real email provider, or strictly reports delivery blocked.
 */
router.post('/invite', requireRoles(['OWNER', 'ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { email, firstName, lastName, role, teamIds } = req.body;
    const organizationId = req.organizationId!;
    const inviter = req.user!;

    if (!email) {
      res.status(400).json({ error: 'Bad Request', message: 'Work email is required' });
      return;
    }

    const trimmedEmail = String(email).toLowerCase().trim();
    if (!EMAIL_REGEX.test(trimmedEmail)) {
      res.status(400).json({ error: 'Bad Request', message: 'Invalid work email format' });
      return;
    }

    const finalFirstName = firstName ? String(firstName).trim() : trimmedEmail.split('@')[0];
    const finalLastName = lastName ? String(lastName).trim() : '';

    const targetRole = role ? String(role).toUpperCase() : 'AGENT';
    if (!['AGENT', 'ADMIN', 'OWNER'].includes(targetRole)) {
      res.status(400).json({ error: 'Bad Request', message: 'Invalid role specified' });
      return;
    }

    // Role Escalation Defense: ADMIN cannot invite OWNER
    if (targetRole === 'OWNER' && inviter.role !== 'OWNER') {
      res.status(403).json({ error: 'Forbidden', message: 'Only organization Owners can invite or assign the OWNER role' });
      return;
    }

    // Verify teamIds belong to current organization
    if (teamIds && Array.isArray(teamIds) && teamIds.length > 0) {
      const validTeams = await prisma.team.findMany({
        where: { id: { in: teamIds }, organizationId },
        select: { id: true },
      });
      if (validTeams.length !== teamIds.length) {
        res.status(400).json({ error: 'Bad Request', message: 'One or more specified teams do not belong to your organization' });
        return;
      }
    }

    // Cryptographically secure invitation token handling (256-bit entropy)
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7-day expiration

    // Unmatchable random password hash: Account can ONLY be activated upon invitation acceptance
    // Supplying initialPassword cannot bypass this lifecycle
    const unmatchableHash = `UNSET_INVITATION_${crypto.randomBytes(32).toString('hex')}`;

    // Atomic serializable transaction with organization row-locking and retry defense:
    // Ensures concurrent invitation requests cannot exceed the plan seat limit under race conditions.
    const user = await withConcurrencyRetry(async () => {
      return prisma.$transaction(
        async (tx) => {
          // 1. Acquire exclusive write lock on Organization row (PostgreSQL FOR UPDATE row lock / SQLite lock)
          await tx.organization.update({
            where: { id: organizationId },
            data: { updatedAt: new Date() },
          });

          // 2. Strict seat entitlement check within locked critical section
          const entitlement = await EntitlementService.canAddAgent(organizationId, tx);
          if (!entitlement.allowed) {
            const err: any = new Error(
              `Agent seat limit reached. Your ${entitlement.plan} plan allows up to ${entitlement.max} agents.`
            );
            err.status = 403;
            throw err;
          }

          // 3. Check existing email in organization
          const existing = await tx.user.findFirst({
            where: { organizationId, email: trimmedEmail },
          });

          if (existing) {
            if (existing.status === 'INVITED') {
              const err: any = new Error(
                'An invitation is already pending for this email. Use resend invitation instead.'
              );
              err.status = 409;
              throw err;
            }
            if (existing.status === 'ACTIVE') {
              const err: any = new Error(
                'A user with this email already exists and is active in your organization'
              );
              err.status = 409;
              throw err;
            }
            if (existing.status === 'DEACTIVATED') {
              // Reactivate previously revoked user via re-invitation workflow
              if (teamIds && Array.isArray(teamIds)) {
                await tx.teamMember.deleteMany({ where: { userId: existing.id } });
                if (teamIds.length > 0) {
                  await tx.teamMember.createMany({
                    data: teamIds.map((teamId: string) => ({ userId: existing.id, teamId })),
                  });
                }
              }

              return tx.user.update({
                where: { id: existing.id },
                data: {
                  firstName: finalFirstName,
                  lastName: finalLastName,
                  role: targetRole as any,
                  status: 'INVITED',
                  passwordHash: unmatchableHash,
                  isAvailable: false,
                  invitationTokenHash: tokenHash,
                  invitationExpiresAt: expiresAt,
                  invitedById: inviter.id,
                },
              });
            }
          }

          return tx.user.create({
            data: {
              organizationId,
              email: trimmedEmail,
              passwordHash: unmatchableHash,
              firstName: finalFirstName,
              lastName: finalLastName,
              role: targetRole as any,
              status: 'INVITED', // STRICT: Always INVITED, never immediately ACTIVE
              isAvailable: false,
              invitationTokenHash: tokenHash,
              invitationExpiresAt: expiresAt,
              invitedById: inviter.id,
              ...(teamIds && Array.isArray(teamIds)
                ? {
                    teamMemberships: {
                      create: teamIds.map((teamId: string) => ({ teamId })),
                    },
                  }
                : {}),
            },
          });
        },
        { isolationLevel: 'Serializable' }
      );
    });

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });

    const invitationUrl = `${config.appUrl}/invite/${rawToken}`;

    // Dispatch real email or report blocked
    const emailResult = await EmailService.sendInvitation({
      to: user.email,
      recipientName: `${user.firstName} ${user.lastName}`.trim(),
      inviterName: `${inviter.email}`,
      organizationName: org?.name || 'Your Team',
      role: targetRole,
      invitationUrl,
      expiresAt,
    });

    // Record audit event
    await prisma.auditEvent.create({
      data: {
        organizationId,
        userId: inviter.id,
        action: 'USER_INVITED',
        entityType: 'User',
        entityId: user.id,
        ipAddress: req.ip || req.socket.remoteAddress || null,
        metadata: JSON.stringify({
          invitedEmail: user.email,
          role: targetRole,
          expiresAt,
          emailDeliveryStatus: emailResult.status,
        }),
      },
    });

    res.status(201).json({
      message: 'Agent invitation successfully created',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        status: user.status,
        invitationExpiresAt: user.invitationExpiresAt,
      },
      invitationUrl,
      emailDelivery: emailResult,
    });
  } catch (err: any) {
    if (err.status) {
      res.status(err.status).json({
        error: err.status === 403 ? 'Forbidden' : 'Conflict',
        message: err.message,
      });
      return;
    }
    if (err.code === 'P2002') {
      res.status(409).json({
        error: 'Conflict',
        message: 'A user with this email already exists in your organization',
      });
      return;
    }
    console.error('[User Invite Error]:', err);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to invite user' });
  }
});

/**
 * POST /api/v1/users/:id/invitation/resend
 * Resends an existing agent invitation with a freshly rotated single-use token and expiration.
 * Concurrency-safe: Conditionally updates status='INVITED'.
 */
router.post('/:id/invitation/resend', requireRoles(['OWNER', 'ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const organizationId = req.organizationId!;
    const inviter = req.user!;

    const targetUser = await prisma.user.findFirst({
      where: { id, organizationId },
      include: { organization: true },
    });

    if (!targetUser) {
      res.status(404).json({ error: 'Not Found', message: 'User not found in your organization' });
      return;
    }

    if (targetUser.status === 'DEACTIVATED') {
      res.status(400).json({
        error: 'Bad Request',
        message: 'This invitation has been revoked. Use the re-invitation workflow to invite this user again.',
      });
      return;
    }

    if (targetUser.status !== 'INVITED') {
      res.status(400).json({ error: 'Bad Request', message: 'User is already active and cannot be reinvited' });
      return;
    }

    // Rotate invitation token and extend expiration
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Concurrency-safe conditional update
    const updateResult = await prisma.user.updateMany({
      where: {
        id: targetUser.id,
        organizationId,
        status: 'INVITED',
      },
      data: {
        invitationTokenHash: tokenHash,
        invitationExpiresAt: expiresAt,
        invitedById: inviter.id,
      },
    });

    if (updateResult.count === 0) {
      res.status(409).json({
        error: 'Conflict',
        message: 'Invitation cannot be resent because the user account is no longer pending invitation',
      });
      return;
    }

    const invitationUrl = `${config.appUrl}/invite/${rawToken}`;

    const emailResult = await EmailService.sendInvitation({
      to: targetUser.email,
      recipientName: `${targetUser.firstName} ${targetUser.lastName}`.trim(),
      inviterName: inviter.email,
      organizationName: targetUser.organization.name,
      role: targetUser.role,
      invitationUrl,
      expiresAt,
    });

    await prisma.auditEvent.create({
      data: {
        organizationId,
        userId: inviter.id,
        action: 'INVITATION_RESENT',
        entityType: 'User',
        entityId: targetUser.id,
        ipAddress: req.ip || req.socket.remoteAddress || null,
        metadata: JSON.stringify({ email: targetUser.email, emailDeliveryStatus: emailResult.status }),
      },
    });

    res.json({
      message: 'Invitation resent successfully',
      invitationUrl,
      emailDelivery: emailResult,
      expiresAt,
    });
  } catch (err: any) {
    console.error('[User Resend Invitation Error]:', err);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to resend invitation' });
  }
});

/**
 * DELETE /api/v1/users/:id/invitation
 * Revoke a pending agent invitation.
 * Retains the user record with status='DEACTIVATED', clears the invitation token hash and expiry,
 * preserves full audit trail, and prevents token inspection or acceptance.
 */
router.delete('/:id/invitation', requireRoles(['OWNER', 'ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const organizationId = req.organizationId!;
    const inviter = req.user!;

    const targetUser = await prisma.user.findFirst({
      where: { id, organizationId },
    });

    if (!targetUser) {
      res.status(404).json({ error: 'Not Found', message: 'User not found in your organization' });
      return;
    }

    if (targetUser.status !== 'INVITED') {
      res.status(400).json({ error: 'Bad Request', message: 'Only pending invitations can be revoked' });
      return;
    }

    await withConcurrencyRetry(async () => {
      return prisma.$transaction(
        async (tx) => {
          // Lock organization row
          await tx.organization.update({
            where: { id: organizationId },
            data: { updatedAt: new Date() },
          });

          // Concurrency defense: transition conditionally where status is still INVITED
          const updateResult = await tx.user.updateMany({
            where: {
              id: targetUser.id,
              organizationId,
              status: 'INVITED',
            },
            data: {
              status: 'DEACTIVATED',
              invitationTokenHash: null,
              invitationExpiresAt: null,
              isAvailable: false,
            },
          });

          if (updateResult.count === 0) {
            const err: any = new Error('Invitation cannot be revoked because user status has already changed');
            err.status = 409;
            throw err;
          }

          // Preserve complete audit history
          await tx.auditEvent.create({
            data: {
              organizationId,
              userId: inviter.id,
              action: 'INVITATION_REVOKED',
              entityType: 'User',
              entityId: targetUser.id,
              ipAddress: req.ip || req.socket.remoteAddress || null,
              metadata: JSON.stringify({
                revokedEmail: targetUser.email,
                previousStatus: 'INVITED',
                newStatus: 'DEACTIVATED',
              }),
            },
          });
        },
        { isolationLevel: 'Serializable' }
      );
    });

    res.json({ message: 'Invitation revoked successfully', status: 'DEACTIVATED' });
  } catch (err: any) {
    if (err.status) {
      res.status(err.status).json({ error: 'Conflict', message: err.message });
      return;
    }
    console.error('[User Revoke Invitation Error]:', err);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to revoke invitation' });
  }
});

/**
 * POST /api/v1/users/:id/invitation/reinvite
 * Explicit re-invitation workflow for a previously revoked/deactivated user.
 * Validates seat capacity with row locking, generates fresh secure single-use token,
 * sets status='INVITED', dispatches invitation email, and logs audit event.
 */
router.post('/:id/invitation/reinvite', requireRoles(['OWNER', 'ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const organizationId = req.organizationId!;
    const inviter = req.user!;

    const targetUser = await prisma.user.findFirst({
      where: { id, organizationId },
      include: { organization: true },
    });

    if (!targetUser) {
      res.status(404).json({ error: 'Not Found', message: 'User not found in your organization' });
      return;
    }

    if (targetUser.status === 'ACTIVE') {
      res.status(400).json({ error: 'Bad Request', message: 'User is already active and cannot be invited' });
      return;
    }

    if (targetUser.status === 'INVITED') {
      res.status(400).json({ error: 'Bad Request', message: 'User already has a pending invitation. Use resend invitation instead.' });
      return;
    }

    // Role escalation check
    if (targetUser.role === 'OWNER' && inviter.role !== 'OWNER') {
      res.status(403).json({ error: 'Forbidden', message: 'Only organization Owners can invite or assign the OWNER role' });
      return;
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const unmatchableHash = `UNSET_INVITATION_${crypto.randomBytes(32).toString('hex')}`;

    const updatedUser = await withConcurrencyRetry(async () => {
      return prisma.$transaction(
        async (tx) => {
          // Lock organization row
          await tx.organization.update({
            where: { id: organizationId },
            data: { updatedAt: new Date() },
          });

          // Entitlement seat check
          const entitlement = await EntitlementService.canAddAgent(organizationId, tx);
          if (!entitlement.allowed) {
            const err: any = new Error(
              `Agent seat limit reached. Your ${entitlement.plan} plan allows up to ${entitlement.max} agents.`
            );
            err.status = 403;
            throw err;
          }

          const updateRes = await tx.user.updateMany({
            where: {
              id: targetUser.id,
              organizationId,
              status: 'DEACTIVATED',
            },
            data: {
              status: 'INVITED',
              passwordHash: unmatchableHash,
              invitationTokenHash: tokenHash,
              invitationExpiresAt: expiresAt,
              invitedById: inviter.id,
              isAvailable: false,
            },
          });

          if (updateRes.count === 0) {
            const err: any = new Error('User status changed concurrently; cannot reinvite');
            err.status = 409;
            throw err;
          }

          await tx.auditEvent.create({
            data: {
              organizationId,
              userId: inviter.id,
              action: 'USER_REINVITED',
              entityType: 'User',
              entityId: targetUser.id,
              ipAddress: req.ip || req.socket.remoteAddress || null,
              metadata: JSON.stringify({
                reinvitedEmail: targetUser.email,
                previousStatus: 'DEACTIVATED',
                newStatus: 'INVITED',
                expiresAt,
              }),
            },
          });

          return tx.user.findUnique({ where: { id: targetUser.id } });
        },
        { isolationLevel: 'Serializable' }
      );
    });

    const invitationUrl = `${config.appUrl}/invite/${rawToken}`;
    const emailResult = await EmailService.sendInvitation({
      to: targetUser.email,
      recipientName: `${targetUser.firstName} ${targetUser.lastName}`.trim(),
      inviterName: inviter.email,
      organizationName: targetUser.organization.name,
      role: targetUser.role,
      invitationUrl,
      expiresAt,
    });

    res.json({
      message: 'Agent re-invited successfully',
      user: {
        id: updatedUser?.id,
        email: updatedUser?.email,
        firstName: updatedUser?.firstName,
        lastName: updatedUser?.lastName,
        role: updatedUser?.role,
        status: updatedUser?.status,
        invitationExpiresAt: updatedUser?.invitationExpiresAt,
      },
      invitationUrl,
      emailDelivery: emailResult,
      expiresAt,
    });
  } catch (err: any) {
    if (err.status) {
      res.status(err.status).json({
        error: err.status === 403 ? 'Forbidden' : 'Conflict',
        message: err.message,
      });
      return;
    }
    console.error('[User Reinvite Error]:', err);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to reinvite user' });
  }
});

/**
 * PATCH /api/v1/users/:id/role
 * Update employee permitted role.
 * Role escalation protections:
 * 1. Admin cannot promote to OWNER.
 * 2. Admin cannot alter an OWNER account.
 * 3. Sole Owner cannot demote themselves.
 */
router.patch('/:id/role', requireRoles(['OWNER', 'ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { role } = req.body;
    const organizationId = req.organizationId!;
    const requester = req.user!;

    const targetRole = String(role || '').toUpperCase();
    if (!['AGENT', 'ADMIN', 'OWNER'].includes(targetRole)) {
      res.status(400).json({ error: 'Bad Request', message: 'Invalid role specified (must be AGENT, ADMIN, or OWNER)' });
      return;
    }

    const targetUser = await prisma.user.findFirst({
      where: { id, organizationId },
    });

    if (!targetUser) {
      res.status(404).json({ error: 'Not Found', message: 'User not found in your organization' });
      return;
    }

    // Role Escalation Defense: Admin cannot promote or demote an Owner
    if ((targetUser.role === 'OWNER' || targetRole === 'OWNER') && requester.role !== 'OWNER') {
      res.status(403).json({ error: 'Forbidden', message: 'Only organization Owners can grant or modify the OWNER role' });
      return;
    }

    // Prevent sole Owner self-demotion
    if (targetUser.id === requester.id && targetUser.role === 'OWNER' && targetRole !== 'OWNER') {
      const ownerCount = await prisma.user.count({
        where: { organizationId, role: 'OWNER', status: 'ACTIVE' },
      });
      if (ownerCount <= 1) {
        res.status(400).json({ error: 'Bad Request', message: 'Cannot demote the sole organization Owner. Transfer ownership first.' });
        return;
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: targetUser.id },
        data: { role: targetRole as any },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
        },
      });

      await tx.auditEvent.create({
        data: {
          organizationId,
          userId: requester.id,
          action: 'USER_ROLE_UPDATED',
          entityType: 'User',
          entityId: targetUser.id,
          ipAddress: req.ip || req.socket.remoteAddress || null,
          metadata: JSON.stringify({ oldRole: targetUser.role, newRole: targetRole }),
        },
      });

      return u;
    });

    res.json({ message: 'User role updated successfully', user: updated });
  } catch (err: any) {
    console.error('[User Role Update Error]:', err);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update user role' });
  }
});

/**
 * PATCH /api/v1/users/:id/teams
 * Assign agents to teams.
 */
router.patch('/:id/teams', requireRoles(['OWNER', 'ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { teamIds } = req.body;
    const organizationId = req.organizationId!;

    if (!Array.isArray(teamIds)) {
      res.status(400).json({ error: 'Bad Request', message: 'teamIds must be an array of team IDs' });
      return;
    }

    const targetUser = await prisma.user.findFirst({
      where: { id, organizationId },
    });

    if (!targetUser) {
      res.status(404).json({ error: 'Not Found', message: 'User not found in your organization' });
      return;
    }

    // Verify all specified teams belong to the same organization
    if (teamIds.length > 0) {
      const validTeams = await prisma.team.findMany({
        where: { id: { in: teamIds }, organizationId },
        select: { id: true },
      });
      if (validTeams.length !== teamIds.length) {
        res.status(400).json({ error: 'Bad Request', message: 'One or more specified teams do not belong to your organization' });
        return;
      }
    }

    await prisma.$transaction(async (tx) => {
      // Remove existing team memberships
      await tx.teamMember.deleteMany({
        where: { userId: targetUser.id },
      });

      // Insert new memberships
      if (teamIds.length > 0) {
        await tx.teamMember.createMany({
          data: teamIds.map((teamId: string) => ({
            userId: targetUser.id,
            teamId,
          })),
        });
      }

      await tx.auditEvent.create({
        data: {
          organizationId,
          userId: req.user!.id,
          action: 'USER_TEAMS_UPDATED',
          entityType: 'User',
          entityId: targetUser.id,
          ipAddress: req.ip || req.socket.remoteAddress || null,
          metadata: JSON.stringify({ teamIds }),
        },
      });
    });

    res.json({ message: 'User team assignments updated successfully' });
  } catch (err: any) {
    console.error('[User Teams Update Error]:', err);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update user teams' });
  }
});

/**
 * PATCH /api/v1/users/:id/status
 * Admins/Owners activate or deactivate an agent account.
 * Deactivation terminates active WebSockets and revokes refresh tokens.
 * Reactivation validates subscription seat limit.
 */
router.patch('/:id/status', requireRoles(['OWNER', 'ADMIN']), async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const { status } = req.body;
    const organizationId = req.organizationId!;

    const rawStatus = String(status || '').toUpperCase();
    const normalizedStatus = rawStatus === 'INACTIVE' ? 'DEACTIVATED' : rawStatus;

    if (!['ACTIVE', 'DEACTIVATED'].includes(normalizedStatus)) {
      res.status(400).json({ error: 'Bad Request', message: 'Valid status (ACTIVE or DEACTIVATED) is required' });
      return;
    }

    const targetUser = await prisma.user.findFirst({
      where: { id, organizationId },
    });

    if (!targetUser) {
      res.status(404).json({ error: 'Not Found', message: 'User not found in your organization' });
      return;
    }

    if (targetUser.id === req.user!.id && normalizedStatus === 'DEACTIVATED') {
      res.status(400).json({ error: 'Bad Request', message: 'Cannot deactivate your own account' });
      return;
    }

    // Seat limit check on reactivation
    if (normalizedStatus === 'ACTIVE' && targetUser.status === 'DEACTIVATED') {
      const agentCheck = await EntitlementService.canAddAgent(organizationId);
      if (!agentCheck.allowed) {
        res.status(403).json({
          error: 'Forbidden',
          message: `Cannot reactivate agent. Your ${agentCheck.plan} plan limit (${agentCheck.max} agents) has been reached.`,
        });
        return;
      }
    }

    const updatedUser = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: targetUser.id },
        data: { status: normalizedStatus as any },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
        },
      });

      if (normalizedStatus === 'DEACTIVATED') {
        // Revoke all refresh tokens
        await tx.refreshToken.updateMany({
          where: { userId: targetUser.id },
          data: { revoked: true },
        });

        await tx.auditEvent.create({
          data: {
            organizationId,
            userId: req.user!.id,
            action: 'USER_DEACTIVATED',
            entityType: 'User',
            entityId: targetUser.id,
            ipAddress: req.ip || req.socket.remoteAddress || null,
            metadata: JSON.stringify({ deactivatedEmail: targetUser.email }),
          },
        });
      } else if (normalizedStatus === 'ACTIVE') {
        await tx.auditEvent.create({
          data: {
            organizationId,
            userId: req.user!.id,
            action: 'USER_REACTIVATED',
            entityType: 'User',
            entityId: targetUser.id,
            ipAddress: req.ip || req.socket.remoteAddress || null,
            metadata: JSON.stringify({ reactivatedEmail: targetUser.email }),
          },
        });
      }

      return u;
    });

    if (normalizedStatus === 'DEACTIVATED') {
      disconnectUserSockets(targetUser.id);
    }

    res.json({
      message: `User status successfully updated to ${normalizedStatus}`,
      user: updatedUser,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update user status' });
  }
});

export default router;
