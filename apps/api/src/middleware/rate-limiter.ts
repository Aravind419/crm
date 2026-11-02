import { Request, Response, NextFunction } from 'express';

interface RateLimitStore {
  [ip: string]: {
    count: number;
    resetTime: number;
  };
}

const store: RateLimitStore = {};

// Clean up expired entries every 5 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const ip in store) {
    if (store[ip].resetTime < now) {
      delete store[ip];
    }
  }
}, 5 * 60 * 1000);

/**
 * In-memory sliding window rate limiter with automated memory cleanup.
 */
export function rateLimiter(options: { windowMs: number; max: number; message?: string }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    if (!store[ip] || now > store[ip].resetTime) {
      store[ip] = {
        count: 1,
        resetTime: now + options.windowMs,
      };
      next();
      return;
    }

    store[ip].count += 1;

    if (store[ip].count > options.max) {
      res.status(429).json({
        error: 'Too Many Requests',
        message: options.message || 'Rate limit exceeded. Please try again shortly.',
      });
      return;
    }

    next();
  };
}
