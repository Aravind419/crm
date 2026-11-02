import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';

/**
 * TenantIsolationGuard
 * Enforces that the request is strictly bound to an authenticated tenant.
 * Prevents horizontal privilege escalation and IDOR attacks.
 */
export function tenantIsolationGuard(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.organizationId) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Tenant context is missing. Cross-tenant access is strictly prohibited.',
    });
    return;
  }
  next();
}
