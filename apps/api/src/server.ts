import express from 'express';
import http from 'http';
import cors from 'cors';
import { config } from './config';
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

const app = express();
const server = http.createServer(app);

// Initialize real-time Socket.IO gateway
initSocketService(server);

// Security & Parsing Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

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

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Unhandled Server Error]:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message || 'An unexpected error occurred',
  });
});

// Start server if executed directly
if (require.main === module) {
  server.listen(config.port, () => {
    console.log(`🚀 SupportOS API Server running on http://localhost:${config.port}`);
    console.log(`⚡ Real-Time Socket.IO Gateway active`);
  });
}

export { app, server };
