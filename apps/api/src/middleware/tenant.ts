import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
import { runInTenantContext } from '../tenancy/tenant-context';

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

/**
 * TenantTransactionMiddleware
 *
 * Establishes an explicit PostgreSQL transaction-local tenant context for the duration
 * of an authenticated HTTP request.
 *
 * Security Guarantees:
 * 1. Parameters: Executes set_config('app.current_organization_id', orgId, true).
 * 2. Strict Request Scope: All tenant database operations within route handlers execute
 *    on the exact transaction connection where the setting was established.
 * 3. Automatic Cleanup: When the response finishes, the transaction cleanly commits and the
 *    setting automatically vanishes from the PostgreSQL connection pool.
 * 4. Error Safety: Any uncaught database error triggers an automatic transaction rollback.
 */
export function tenantTransactionMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const orgId = req.organizationId;
  if (!orgId) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Tenant context is missing. Cross-tenant access is strictly prohibited.',
    });
    return;
  }

  // Intercept res.end so that the database transaction COMMITS BEFORE the response is flushed to the network.
  // This guarantees that any subsequent client request (e.g. login immediately following status update)
  // reads the committed state and never races against an asynchronous post-response commit.
  const originalEnd = res.end.bind(res);
  let endArgs: any[] | null = null;
  let responseEnded = false;

  const responseReadyPromise = new Promise<void>((resolveReady, rejectReady) => {
    (res as any).end = function (...args: any[]) {
      if (!responseEnded) {
        responseEnded = true;
        endArgs = args;
        resolveReady();
      }
      return res;
    };

    res.once('close', () => {
      if (!responseEnded) {
        responseEnded = true;
        rejectReady(new Error('Client connection closed prematurely'));
      }
    });

    res.once('error', (err) => {
      if (!responseEnded) {
        responseEnded = true;
        rejectReady(err);
      }
    });
  });

  runInTenantContext(
    orgId,
    async (_tx) => {
      next();
      await responseReadyPromise;
    },
    { actorId: req.user?.id, actorType: 'AGENT' }
  )
    .then(() => {
      // Transaction is committed in PostgreSQL! Flush intercepted response to client.
      if (endArgs) {
        originalEnd(...(endArgs as [any?, any?, any?]));
      } else {
        originalEnd();
      }
    })
    .catch((err) => {
      if (!res.headersSent) {
        next(err);
      } else if (endArgs) {
        originalEnd(...(endArgs as [any?, any?, any?]));
      }
    });
}
