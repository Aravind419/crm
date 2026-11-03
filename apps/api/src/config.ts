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
  emailDriver: process.env.EMAIL_DRIVER || (process.env.NODE_ENV === 'production' ? 'smtp' : 'mock'),
  enableInternalDiagnostics: process.env.ENABLE_INTERNAL_DIAGNOSTICS === 'true',
  appUrl: (process.env.APP_URL && !process.env.APP_URL.includes('localhost'))
    ? process.env.APP_URL
    : (process.env.NEXT_PUBLIC_APP_URL && !process.env.NEXT_PUBLIC_APP_URL.includes('localhost'))
    ? process.env.NEXT_PUBLIC_APP_URL
    : 'https://app.supportos.dev',
};

export function validateSecurityConfig(customCfg?: Partial<typeof config>): void {
  const nodeEnv = customCfg?.nodeEnv ?? process.env.NODE_ENV ?? config.nodeEnv;
  const jwtSecret = customCfg?.jwtSecret ?? process.env.JWT_SECRET ?? config.jwtSecret;
  const billingWebhookSecret = customCfg?.billingWebhookSecret ?? process.env.BILLING_WEBHOOK_SECRET ?? config.billingWebhookSecret;
  const requireRedis = customCfg?.requireRedis ?? (process.env.REQUIRE_REDIS === 'true');
  const redisUrl = customCfg?.redisUrl !== undefined ? customCfg.redisUrl : (process.env.REDIS_URL || null);
  const corsOrigins = customCfg?.corsOrigins ?? config.corsOrigins;

  if (nodeEnv === 'production') {
    if (process.env.ALLOW_UNSCOPED_ADMIN_QUERIES === 'true') {
      throw new Error(
        '[CRITICAL SECURITY ERROR] ALLOW_UNSCOPED_ADMIN_QUERIES is strictly prohibited in production. Unscoped database queries cannot bypass tenant isolation in production.'
      );
    }

    const INSECURE_PATTERNS = [
      'dev_secret',
      'dev_billing',
      'change_in_production',
      'super_secret',
      'enterprise_2026',
      'placeholder',
      'example',
      'secret_key',
      'replace_with',
      'password123',
    ];

    const isPredictable = (val: string) =>
      INSECURE_PATTERNS.some((p) => val.toLowerCase().includes(p));

    if (!jwtSecret || jwtSecret.length < 32 || isPredictable(jwtSecret)) {
      throw new Error(
        '[CRITICAL SECURITY ERROR] Insecure, missing, or predictable JWT_SECRET in production environment. A cryptographically strong secret (>= 32 characters, non-placeholder) must be configured.'
      );
    }
    if (!billingWebhookSecret || billingWebhookSecret.length < 32 || isPredictable(billingWebhookSecret)) {
      throw new Error(
        '[CRITICAL SECURITY ERROR] Insecure, missing, or predictable BILLING_WEBHOOK_SECRET in production environment. A cryptographically strong secret (>= 32 characters, non-placeholder) must be configured.'
      );
    }
    if (requireRedis && (!redisUrl || !redisUrl.trim())) {
      throw new Error(
        '[CRITICAL SECURITY ERROR] REQUIRE_REDIS=true is set in production, but REDIS_URL is not configured. Distributed deployment requires a valid Redis connection string.'
      );
    }
    if (corsOrigins.includes('*')) {
      throw new Error(
        '[CRITICAL SECURITY ERROR] CORS_ORIGIN cannot contain wildcard "*" in production because administrative credentials (cookies/authorization headers) are supported. Specify explicit origin domains.'
      );
    }
    for (const origin of corsOrigins) {
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

    const emailDriver = customCfg?.emailDriver ?? process.env.EMAIL_DRIVER;
    if (emailDriver === 'mock') {
      throw new Error(
        '[CRITICAL SECURITY ERROR] Production environment cannot use mock email delivery (EMAIL_DRIVER=mock). Real transactional SMTP or Resend credentials must be configured.'
      );
    }
    if (emailDriver === 'smtp' && (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS)) {
      throw new Error(
        '[CRITICAL SECURITY ERROR] EMAIL_DRIVER=smtp in production requires SMTP_HOST, SMTP_USER, and SMTP_PASS.'
      );
    }
    if (emailDriver === 'resend' && !process.env.RESEND_API_KEY) {
      throw new Error(
        '[CRITICAL SECURITY ERROR] EMAIL_DRIVER=resend in production requires RESEND_API_KEY.'
      );
    }
  }
}

// Run startup validation
validateSecurityConfig();
