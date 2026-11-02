import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { getRedisClient } from '../services/redis.service';

interface MemoryRateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

const memoryStore: MemoryRateLimitStore = {};

// Clean up expired entries every 5 minutes to prevent memory leaks (unref'd to prevent hanging processes)
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const k in memoryStore) {
    if (memoryStore[k].resetTime < now) {
      delete memoryStore[k];
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
 */
if (!config.redisUrl && config.nodeEnv === 'production') {
  console.warn(
    '[Security Architecture Warning] REDIS_URL is not configured. Running rate limiter in single-instance in-memory mode. Horizontal container scaling requires Redis.'
  );
}

/**
 * Resolves client IP safely without blindly trusting unverified X-Forwarded-For headers.
 * When trustProxy is false, only the physical socket remoteAddress or verified req.ip is used.
 */
export function resolveClientIp(req: Request): string {
  if (config.trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      const parts = forwarded.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length > 0) {
        return parts[0];
      }
    }
    if (req.ip) return req.ip;
  }
  return req.socket.remoteAddress || req.ip || '127.0.0.1';
}

const LUA_RATE_LIMIT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return current
`;

/**
 * Sliding window rate limiter.
 * Supports distributed Redis atomic counters and single-instance in-memory fallback.
 */
export function rateLimiter(options: {
  windowMs: number;
  max: number;
  message?: string;
  prefix?: string;
  redisClientOverride?: any;
}) {
  const prefix = options.prefix || 'api';

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ip = resolveClientIp(req);
      const key = `ratelimit:${prefix}:${ip}`;
      const redis = options.redisClientOverride || getRedisClient();

      if (redis && (redis.status === 'ready' || redis.status === 'connecting' || typeof redis.eval === 'function')) {
        try {
          const count = (await redis.eval(
            LUA_RATE_LIMIT,
            1,
            key,
            String(options.windowMs)
          )) as number;

          res.setHeader('X-RateLimit-Limit', options.max);
          res.setHeader('X-RateLimit-Remaining', Math.max(0, options.max - count));

          if (count > options.max) {
            res.status(429).json({
              error: 'Too Many Requests',
              message: options.message || 'Rate limit exceeded. Please try again shortly.',
            });
            return;
          }

          next();
          return;
        } catch (redisErr: any) {
          console.error('[Distributed Rate Limiter Redis Error]:', redisErr.message);
          if (config.requireRedis) {
            res.status(503).json({
              error: 'Service Unavailable',
              message: 'Distributed rate limiting backend unavailable',
            });
            return;
          }
        }
      }

      if (config.requireRedis) {
        res.status(503).json({
          error: 'Service Unavailable',
          message: 'Distributed rate limiting backend required but unconfigured',
        });
        return;
      }

      // Explicit Enforced Single-Instance In-Memory Mode
      const now = Date.now();
      if (!memoryStore[key] || now > memoryStore[key].resetTime) {
        memoryStore[key] = {
          count: 1,
          resetTime: now + options.windowMs,
        };
        res.setHeader('X-RateLimit-Limit', options.max);
        res.setHeader('X-RateLimit-Remaining', options.max - 1);
        next();
        return;
      }

      memoryStore[key].count += 1;
      res.setHeader('X-RateLimit-Limit', options.max);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, options.max - memoryStore[key].count));

      if (memoryStore[key].count > options.max) {
        res.status(429).json({
          error: 'Too Many Requests',
          message: options.message || 'Rate limit exceeded. Please try again shortly.',
        });
        return;
      }

      next();
    } catch (err: any) {
      console.error('[Rate Limiter Internal Error]:', err);
      if (config.nodeEnv === 'production' || config.requireRedis) {
        res.status(503).json({
          error: 'Service Unavailable',
          message: 'Distributed rate limiting check encountered an unexpected error',
        });
        return;
      }
      next();
    }
  };
}
