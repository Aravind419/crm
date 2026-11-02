import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from root if not already loaded
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const rawCors = process.env.CORS_ORIGIN || process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000';

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  jwtSecret: process.env.JWT_SECRET || 'supportos_dev_secret_key_change_in_production_2026',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  refreshTokenExpiresDays: 30,
  corsOrigins: rawCors.split(',').map((s) => s.trim()).filter(Boolean),
  allowedWidgetOrigins: (process.env.ALLOWED_WIDGET_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean),
  nodeEnv: process.env.NODE_ENV || 'development',
  billingWebhookSecret: process.env.BILLING_WEBHOOK_SECRET || 'supportos_dev_billing_secret_2026',
  redisUrl: process.env.REDIS_URL || null,
  requireRedis: process.env.REQUIRE_REDIS === 'true',
  trustProxy: process.env.TRUST_PROXY === 'true',
  appUrl: (process.env.APP_URL && !process.env.APP_URL.includes('localhost'))
    ? process.env.APP_URL
    : (process.env.NEXT_PUBLIC_APP_URL && !process.env.NEXT_PUBLIC_APP_URL.includes('localhost'))
    ? process.env.NEXT_PUBLIC_APP_URL
    : 'https://app.supportos.dev',
};

export function validateSecurityConfig(cfg = config): void {
  if (cfg.nodeEnv === 'production') {
    if (!cfg.jwtSecret || cfg.jwtSecret.includes('dev_secret') || cfg.jwtSecret.length < 32) {
      throw new Error(
        '[CRITICAL SECURITY ERROR] Insecure or missing JWT_SECRET in production environment. A cryptographically strong secret (>= 32 characters) must be configured.'
      );
    }
    if (!cfg.billingWebhookSecret || cfg.billingWebhookSecret.includes('dev_billing') || cfg.billingWebhookSecret.length < 32) {
      throw new Error(
        '[CRITICAL SECURITY ERROR] Insecure or missing BILLING_WEBHOOK_SECRET in production environment. A cryptographically strong secret (>= 32 characters) must be configured.'
      );
    }
    if (cfg.requireRedis && (!cfg.redisUrl || !cfg.redisUrl.trim())) {
      throw new Error(
        '[CRITICAL SECURITY ERROR] REQUIRE_REDIS=true is set in production, but REDIS_URL is not configured. Distributed deployment requires a valid Redis connection string.'
      );
    }
    if (cfg.corsOrigins.includes('*')) {
      throw new Error(
        '[CRITICAL SECURITY ERROR] CORS_ORIGIN cannot contain wildcard "*" in production because administrative credentials (cookies/authorization headers) are supported. Specify explicit origin domains.'
      );
    }
    for (const origin of cfg.corsOrigins) {
      try {
        const parsed = new URL(origin);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          throw new Error(`Invalid protocol ${parsed.protocol}`);
        }
      } catch (e: any) {
        throw new Error(
          `[CRITICAL SECURITY ERROR] Invalid CORS_ORIGIN URL "${origin}": ${e.message}`
        );
      }
    }
  }
}

// Run startup validation
validateSecurityConfig();
