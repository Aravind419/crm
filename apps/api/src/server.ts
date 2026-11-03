import express from 'express';
import http from 'http';
import { config, validateSecurityConfig } from './config';
import { initSocketService } from './services/socket.service';

// Route handlers
import authRoutes from './routes/auth.routes';
import orgRoutes from './routes/organizations.routes';
import teamRoutes from './routes/teams.routes';
import userRoutes from './routes/users.routes';
import inboxRoutes from './routes/inboxes.routes';
import conversationRoutes from './routes/conversations.routes';
import ticketRoutes from './routes/tickets.routes';
import customerRoutes from './routes/customers.routes';
import knowledgeBaseRoutes from './routes/knowledge-base.routes';
import automationRoutes from './routes/automations.routes';
import reportRoutes from './routes/reports.routes';
import publicRoutes from './routes/public.routes';

import * as crypto from 'crypto';
import { httpRequestStorage } from './tenancy/http-request-context';
import { markAsServerProcess } from './process-identity';

// Mark process as an HTTP application server process
markAsServerProcess();

const app = express();
const server = http.createServer(app);

// 0. HTTP Request Context Tracker (Prevents privilege escalation to administrative DB mode during HTTP requests)
app.use((req, res, next) => {
  const store = {
    requestId: (req.headers['x-request-id'] as string) || crypto.randomUUID(),
    path: req.path,
    method: req.method,
    ip: req.ip,
    timestamp: Date.now(),
  };
  httpRequestStorage.run(store, () => next());
});

if (config.trustProxy) {
  app.set('trust proxy', 1);
}

// Initialize real-time Socket.IO gateway
initSocketService(server);

// 1. Enterprise Security Response Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0');
  if (config.nodeEnv === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// 2. Strict Differentiated CORS
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const isPublicRoute = req.path.startsWith('/api/v1/public') || req.path === '/health';

  if (isPublicRoute) {
    // Public widget endpoints allow customer websites without credentials
    const isAllowedWidget =
      config.allowedWidgetOrigins.includes('*') ||
      (origin && config.allowedWidgetOrigins.includes(origin));

    if (isAllowedWidget && origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (config.allowedWidgetOrigins.includes('*')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-visitor-token');
  } else if (origin) {
    // Protected administrative routes enforce strict allow-list
    const isAllowed =
      config.corsOrigins.includes(origin) ||
      (config.nodeEnv !== 'production' &&
        (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')));

    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, x-visitor-token, x-billing-signature, x-billing-timestamp, x-billing-event-id'
      );
    }
  }

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// 3. Strict Payload Limits with rawBody capture for cryptographic signature verification
app.use('/api/v1/public', express.json({ limit: '50kb' }));
app.use(
  express.json({
    limit: '5mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Request logging in development
if (config.nodeEnv === 'development') {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      console.log(`[HTTP] ${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - start}ms)`);
    });
    next();
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    product: 'SupportOS',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/organizations', orgRoutes);
app.use('/api/v1/teams', teamRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/inboxes', inboxRoutes);
app.use('/api/v1/conversations', conversationRoutes);
app.use('/api/v1/tickets', ticketRoutes);
app.use('/api/v1/customers', customerRoutes);
app.use('/api/v1/knowledge-base', knowledgeBaseRoutes);
app.use('/api/v1/automations', automationRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/public', publicRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', message: `Route ${req.method} ${req.url} does not exist` });
});

// Secure error handling middleware (Never leak internal database structures or stack traces)
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Unhandled Server Error]:', err);
  const isProd = config.nodeEnv === 'production';
  res.status(err.status || 500).json({
    error: err.name || 'Internal Server Error',
    message: isProd ? 'An unexpected internal error occurred' : (err.message || 'An unexpected error occurred'),
  });
});

// Start server if executed directly
if (require.main === module) {
  // Fail closed immediately on boot if production security criteria or required distributed backends are unmet
  if (config.nodeEnv === 'production' || config.requireRedis) {
    try {
      validateSecurityConfig();
      console.log('🛡️ Production security configuration verified successfully');
    } catch (configErr: any) {
      console.error(configErr.message);
      process.exit(1);
    }
  }

  server.listen(config.port, () => {
    console.log(`🚀 SupportOS API Server running on http://localhost:${config.port}`);
    console.log(`⚡ Real-Time Socket.IO Gateway active`);
  });

  const handleShutdown = async (signal: string) => {
    console.log(`[Server] Received ${signal}. Gracefully terminating HTTP server and background connections...`);
    server.close(async () => {
      try {
        const { closeRedis } = await import('./services/redis.service');
        await closeRedis();
      } catch (_) {}
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));

  process.on('unhandledRejection', (reason: any) => {
    // Neon serverless auto-suspends compute and terminates idle sockets.
    // Suppress fatal process exit on closed pooled socket notifications.
    if (reason?.message?.includes('Closed') || reason?.kind === 'Closed') {
      console.warn('[Prisma/Neon] Idle connection dropped by remote serverless pooler. Ready for next query.');
      return;
    }
    console.warn('[Process] Unhandled Rejection:', reason);
  });

  process.on('uncaughtException', (err: any) => {
    if (err?.message?.includes('Closed') || err?.kind === 'Closed') {
      console.warn('[Prisma/Neon] Idle connection dropped by remote serverless pooler. Ready for next query.');
      return;
    }
    console.error('[Process] Uncaught Exception:', err);
  });
}

export { app, server };
