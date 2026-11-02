import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from root if not already loaded
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  jwtSecret: process.env.JWT_SECRET || 'supportos_dev_secret_key_change_in_production_2026',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  refreshTokenExpiresDays: 30,
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:3000,http://127.0.0.1:3000').split(',').map(s => s.trim()),
  allowedWidgetOrigins: (process.env.ALLOWED_WIDGET_ORIGINS || '*').split(',').map(s => s.trim()),
  nodeEnv: process.env.NODE_ENV || 'development',
  billingWebhookSecret: process.env.BILLING_WEBHOOK_SECRET || 'supportos_dev_billing_secret_2026',
  redisUrl: process.env.REDIS_URL || null,
};

export function validateSecurityConfig(): void {
  if (config.nodeEnv === 'production') {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('dev_secret') || process.env.JWT_SECRET.length < 32) {
      throw new Error('[CRITICAL SECURITY ERROR] Insecure or missing JWT_SECRET in production environment. A cryptographically strong secret (>= 32 characters) must be configured.');
    }
    if (!process.env.BILLING_WEBHOOK_SECRET || process.env.BILLING_WEBHOOK_SECRET.includes('dev_billing') || process.env.BILLING_WEBHOOK_SECRET.length < 32) {
      throw new Error('[CRITICAL SECURITY ERROR] Insecure or missing BILLING_WEBHOOK_SECRET in production environment. A cryptographically strong secret (>= 32 characters) must be configured.');
    }
  }
}

// Run validation
validateSecurityConfig();
