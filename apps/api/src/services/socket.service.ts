import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { config } from '../config';
import { prisma } from '../prisma';

let io: SocketIOServer | null = null;

export function initSocketService(server: HttpServer): SocketIOServer {
  io = new SocketIOServer(server, {
    cors: {
      origin: (origin, callback) => {
        // Allow same-origin or non-browser server-to-server requests
        if (!origin) return callback(null, true);

        // Allow configured agent/admin web origins
        const isAgentOrigin =
          config.corsOrigins.includes(origin) ||
          origin.startsWith('http://localhost') ||
          origin.startsWith('http://127.0.0.1');

        if (isAgentOrigin) {
          return callback(null, true);
        }

        // Allow configured widget embedder origins
        const isWidgetAllowed =
          config.allowedWidgetOrigins.includes('*') ||
          config.allowedWidgetOrigins.includes(origin);

        if (isWidgetAllowed) {
          return callback(null, true);
        }

        // Deliberate rejection of unauthorized origins
        return callback(new Error('Origin rejected by Socket.IO CORS security policy'), false);
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // Strict Connection Authentication Middleware
  io.use(async (socket: Socket, next) => {
    try {
      // 1. Check for Agent JWT Authentication
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
      if (token) {
        // ORIGIN SECURITY: Agent credentials can ONLY be used from authorized agent origins
        const socketOrigin = socket.handshake.headers?.origin;
        const isAuthorizedAgentOrigin =
          !socketOrigin ||
          config.corsOrigins.includes(socketOrigin) ||
          socketOrigin.startsWith('http://localhost') ||
          socketOrigin.startsWith('http://127.0.0.1');

        if (!isAuthorizedAgentOrigin) {
          return next(new Error('Authentication failed: Agent credentials cannot be utilized from unauthorized origin'));
        }

        try {
          const payload = jwt.verify(token, config.jwtSecret) as {
            userId: string;
            organizationId: string;
            role: string;
          };

          // Verify agent exists and status is ACTIVE
          const user = await prisma.user.findUnique({
            where: { id: payload.userId },
            select: { id: true, organizationId: true, status: true, role: true },
          });

          if (user && user.status === 'ACTIVE' && user.organizationId === payload.organizationId) {
            socket.data.userId = user.id;
            socket.data.organizationId = user.organizationId;
            socket.data.userRole = user.role;
            socket.data.isAgent = true;
            return next();
          }
        } catch (jwtErr) {
          return next(new Error('Authentication failed: Invalid or expired agent token'));
        }
      }

      // 2. Check for Public Widget Visitor Session Authentication
      const visitorToken = socket.handshake.auth?.visitorToken || socket.handshake.query?.visitorToken;
      const conversationId = socket.handshake.auth?.conversationId || socket.handshake.query?.conversationId;

      if (visitorToken && conversationId) {
        const rawToken = String(visitorToken).trim();
        const convId = String(conversationId).trim();

        if (!rawToken || !convId) {
          return next(new Error('Authentication failed: Missing token or conversation ID'));
        }

        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

        // Look up verified visitor session strictly by SHA-256 tokenHash
        const session = await prisma.visitorSession.findFirst({
          where: { tokenHash },
          select: {
            id: true,
            customerId: true,
            conversationId: true,
            expiresAt: true,
            revokedAt: true,
          },
        });

        if (!session) {
          return next(new Error('Authentication failed: Invalid visitor session credentials'));
        }

        if (session.revokedAt) {
          return next(new Error('Authentication failed: Visitor session has been revoked'));
        }

        if (session.expiresAt < new Date()) {
          return next(new Error('Authentication failed: Visitor session expired'));
        }

        // Strict Conversation ID binding: session MUST have a non-null conversationId matching the requested convId
        if (!session.conversationId || session.conversationId !== convId) {
          return next(new Error('Authentication failed: Visitor session token not authorized for this conversation'));
        }

        socket.data.visitorToken = rawToken;
        socket.data.tokenHash = tokenHash;
        socket.data.conversationId = convId;
        socket.data.customerId = session.customerId;
        socket.data.isVisitor = true;
        return next();
      }

      // 3. Reject Unauthenticated Connections
      return next(new Error('Authentication required: Valid agent token or visitor session must be provided'));
    } catch (err: any) {
      console.error('[Socket Auth Middleware Error]:', err);
      return next(new Error('Internal socket authentication failure'));
    }
  });

  io.on('connection', (socket: Socket) => {
    // Automatically join authorized tenant or thread rooms based on verified identity
    if (socket.data.isAgent && socket.data.organizationId) {
      const orgRoom = `org:${socket.data.organizationId}`;
      socket.join(orgRoom);
    }

    if (socket.data.isVisitor && socket.data.conversationId) {
      const convRoom = `conv:${socket.data.conversationId}`;
      socket.join(convRoom);
    }

    // Explicit room join request with authorization enforcement
    socket.on('join:conversation', async (conversationId: string) => {
      try {
        if (!conversationId) return;

        // Rule A: Agents can only join conversations within their own organization
        if (socket.data.isAgent && socket.data.organizationId) {
          const conv = await prisma.conversation.findFirst({
            where: {
              id: conversationId,
              organizationId: socket.data.organizationId,
            },
            select: { id: true },
          });

          if (conv) {
            socket.join(`conv:${conversationId}`);
          } else {
            console.warn(`[Socket Security] Unauthorized agent conversation join attempt blocked for org ${socket.data.organizationId}`);
            socket.emit('error:unauthorized', { message: 'Cross-tenant conversation access denied' });
          }
          return;
        }

        // Rule B: Visitors can only join their authorized conversation
        if (socket.data.isVisitor && socket.data.conversationId) {
          if (socket.data.conversationId === conversationId) {
            socket.join(`conv:${conversationId}`);
          } else {
            console.warn(`[Socket Security] Visitor attempted to join unauthorized conversation ${conversationId}`);
            socket.emit('error:unauthorized', { message: 'Visitor cannot access other conversations' });
          }
          return;
        }

        socket.emit('error:unauthorized', { message: 'Authentication required to join conversation rooms' });
      } catch (err) {
        console.error('[Socket Join Error]:', err);
      }
    });

    socket.on('leave:conversation', (conversationId: string) => {
      socket.leave(`conv:${conversationId}`);
    });

    // Validated typing indicator
    socket.on('typing:start', async (data: { conversationId: string; senderName: string }) => {
      if (!data?.conversationId) return;

      // Verify sender is authorized for this conversation
      let authorized = false;
      if (socket.data.isVisitor && socket.data.conversationId === data.conversationId) {
        authorized = true;
      } else if (socket.data.isAgent && socket.data.organizationId) {
        const conv = await prisma.conversation.findFirst({
          where: { id: data.conversationId, organizationId: socket.data.organizationId },
          select: { id: true },
        });
        if (conv) authorized = true;
      }

      if (authorized) {
        socket.to(`conv:${data.conversationId}`).emit('typing:indicator', {
          conversationId: data.conversationId,
          senderName: data.senderName,
          isTyping: true,
        });
      }
    });

    socket.on('typing:stop', async (data: { conversationId: string }) => {
      if (!data?.conversationId) return;

      let authorized = false;
      if (socket.data.isVisitor && socket.data.conversationId === data.conversationId) {
        authorized = true;
      } else if (socket.data.isAgent && socket.data.organizationId) {
        const conv = await prisma.conversation.findFirst({
          where: { id: data.conversationId, organizationId: socket.data.organizationId },
          select: { id: true },
        });
        if (conv) authorized = true;
      }

      if (authorized) {
        socket.to(`conv:${data.conversationId}`).emit('typing:indicator', {
          conversationId: data.conversationId,
          isTyping: false,
        });
      }
    });

    socket.on('disconnect', () => {});
  });

  return io;
}

export function getSocketIO(): SocketIOServer | null {
  return io;
}

export function broadcastToOrg(organizationId: string, event: string, payload: any): void {
  if (!io) return;
  io.to(`org:${organizationId}`).emit(event, payload);
}

/**
 * Broadcasts events to conversation rooms.
 * CRITICAL PRIVACY DEFENSE: Never deliver INTERNAL_NOTE messages to conversation rooms
 * because visitors reside in those rooms. Internal notes are strictly for agents via broadcastToOrg.
 */
export function broadcastToConversation(conversationId: string, event: string, payload: any): void {
  if (!io) return;

  if (event === 'message:created' && payload?.messageType === 'INTERNAL_NOTE') {
    // Block internal private notes from reaching visitor socket room
    return;
  }

  io.to(`conv:${conversationId}`).emit(event, payload);
}

/**
 * Immediately severs active WebSocket connections for a revoked visitor session
 * and emits a session revoked error event so client-side state is purged.
 */
export function disconnectVisitorSockets(tokenOrHash: string): void {
  if (!io || !tokenOrHash) return;
  const hash = tokenOrHash.length === 64 ? tokenOrHash : crypto.createHash('sha256').update(tokenOrHash).digest('hex');
  for (const [, socket] of io.sockets.sockets) {
    if (socket.data?.isVisitor && (socket.data?.tokenHash === hash || socket.data?.visitorToken === tokenOrHash)) {
      socket.emit('error:session_revoked', { message: 'Visitor session has been revoked' });
      socket.disconnect(true);
    }
  }
}

/**
 * Immediately severs active WebSocket connections for a deactivated or logged-out agent.
 */
export function disconnectUserSockets(userId: string): void {
  if (!io || !userId) return;
  for (const [, socket] of io.sockets.sockets) {
    if (socket.data?.isAgent && socket.data?.userId === userId) {
      socket.emit('error:account_deactivated', { message: 'Agent account session has been terminated' });
      socket.disconnect(true);
    }
  }
}

