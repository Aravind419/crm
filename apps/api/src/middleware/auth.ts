import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import { config } from '../config';
import { runInTenantContext } from '../tenancy/tenant-context';

export interface AuthenticatedUser {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  firstName: string;
  lastName: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  organizationId?: string;
}

export async function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized', message: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, config.jwtSecret) as {
      userId: string;
      organizationId: string;
      email: string;
      role: string;
    };

    if (!payload.userId || !payload.organizationId) {
      res.status(401).json({ error: 'Unauthorized', message: 'Malformed session token payload' });
      return;
    }

    // Verify user under transaction-local PostgreSQL RLS context
    const user = await runInTenantContext(payload.organizationId, async (tx) => {
      return tx.user.findUnique({
        where: { id: payload.userId },
        select: {
          id: true,
          organizationId: true,
          email: true,
          role: true,
          firstName: true,
          lastName: true,
          status: true,
        },
      });
    }, { actorId: payload.userId, actorType: 'AGENT' });

    if (!user || user.status !== 'ACTIVE' || user.organizationId !== payload.organizationId) {
      res.status(401).json({ error: 'Unauthorized', message: 'User account is inactive or not found' });
      return;
    }

    req.user = user;
    req.organizationId = user.organizationId;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired session token' });
    return;
  }
}
