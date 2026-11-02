import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';

/**
 * Role-Based Access Control (RBAC) Guard
 * Validates that the authenticated user possesses one of the required roles.
 */
export function requireRoles(allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: 'Forbidden',
        message: `Insufficient permissions. Requires one of: [${allowedRoles.join(', ')}]`,
      });
      return;
    }

    next();
  };
}
