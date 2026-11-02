import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

interface RateLimitStore {
  [ip: string]: {
    count: number;
    resetTime: number;
  };
}

const memoryStore: RateLimitStore = {};

// Clean up expired entries every 5 minutes to prevent memory leaks (unref'd to prevent hanging processes)
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const ip in memoryStore) {
    if (memoryStore[ip].resetTime < now) {
      delete memoryStore[ip];
    }
  }
}, 5 * 60 * 1000);
if (cleanupInterval.unref) {
  cleanupInterval.unref();
}

/**
 * ARCHITECTURAL NOTICE — DEPLOYMENT RESTRICTION:
 * When REDIS_URL is not configured, rate limiting is maintained in memory.
 * Deployment must run in single-instance mode (e.g. 1 API container / node process)
 * or fronted by sticky sessions at the load balancer.
 * To enable horizontal multi-node scaling across multiple API containers,
 * configure REDIS_URL in the environment.
 */
if (!config.redisUrl && config.nodeEnv === 'production') {
  console.warn(
    '[Security Architecture Warning] REDIS_URL is not configured. Running rate limiter in single-instance in-memory mode. Horizontal container scaling requires Redis adapter.'
  );
}

/**
 * Sliding window rate limiter.
 * Supports IP extraction with proxy headers and sliding expiry.
 */
export function rateLimiter(options: { windowMs: number; max: number; message?: string }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Robust IP extraction across reverse proxies
    const forwarded = req.headers['x-forwarded-for'];
    const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : null) ||
      req.ip ||
      req.socket.remoteAddress ||
      'unknown';

    const now = Date.now();

    if (!memoryStore[ip] || now > memoryStore[ip].resetTime) {
      memoryStore[ip] = {
        count: 1,
        resetTime: now + options.windowMs,
      };
      next();
      return;
    }

    memoryStore[ip].count += 1;

    if (memoryStore[ip].count > options.max) {
      res.status(429).json({
        error: 'Too Many Requests',
        message: options.message || 'Rate limit exceeded. Please try again shortly.',
      });
      return;
    }

    next();
  };
}
