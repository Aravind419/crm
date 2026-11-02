import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../prisma';

let io: SocketIOServer | null = null;

export function initSocketService(server: HttpServer): SocketIOServer {
  io = new SocketIOServer(server, {
    cors: {
      origin: '*', // Allow public widget & web application
      methods: ['GET', 'POST'],
    },
  });

  io.use((socket: Socket, next) => {
    // 1. Check for Agent JWT Token
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
    if (token) {
      try {
        const payload = jwt.verify(token, config.jwtSecret) as {
          userId: string;
          organizationId: string;
          role: string;
        };
        socket.data.userId = payload.userId;
        socket.data.organizationId = payload.organizationId;
        socket.data.isAgent = true;
        return next();
      } catch (err) {
        // Fallback for public visitor widget
      }
    }

    // 2. Check for Visitor Session
    const visitorSession = socket.handshake.auth?.visitorToken || socket.handshake.query?.visitorToken;
    const conversationId = socket.handshake.auth?.conversationId || socket.handshake.query?.conversationId;

    if (visitorSession && conversationId) {
      socket.data.visitorToken = String(visitorSession);
      socket.data.conversationId = String(conversationId);
      socket.data.isVisitor = true;
      return next();
    }

    next();
  });

  io.on('connection', (socket: Socket) => {
    if (socket.data.isAgent && socket.data.organizationId) {
      const orgRoom = `org:${socket.data.organizationId}`;
      socket.join(orgRoom);
      console.log(`[Socket] Agent ${socket.data.userId} connected to room ${orgRoom}`);
    }

    if (socket.data.isVisitor && socket.data.conversationId) {
      const convRoom = `conv:${socket.data.conversationId}`;
      socket.join(convRoom);
      console.log(`[Socket] Visitor joined thread room ${convRoom}`);
    }

    // Secure conversation room join handler with strict tenant & ownership checks
    socket.on('join:conversation', async (conversationId: string) => {
      try {
        if (!conversationId) return;

        // Rule A: Authenticated Agents can only join conversations belonging to their organization
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
            console.log(`[Socket] Agent ${socket.data.userId} authorized to join conv:${conversationId}`);
          } else {
            console.warn(`[Socket Security] Unauthorized agent conversation join attempt blocked for org ${socket.data.organizationId}`);
            socket.emit('error:unauthorized', { message: 'Cross-tenant conversation access denied' });
          }
          return;
        }

        // Rule B: Visitors can ONLY join the conversation that matches their verified visitor session
        if (socket.data.isVisitor && socket.data.conversationId) {
          if (socket.data.conversationId === conversationId) {
            socket.join(`conv:${conversationId}`);
            console.log(`[Socket] Visitor authorized to join conv:${conversationId}`);
          } else {
            console.warn(`[Socket Security] Visitor attempted to join unauthorized conversation ${conversationId}`);
            socket.emit('error:unauthorized', { message: 'Visitor cannot access other conversations' });
          }
          return;
        }

        // Rule C: Anonymous unauthenticated sockets cannot join conversation rooms
        console.warn(`[Socket Security] Anonymous socket rejected from joining conv:${conversationId}`);
        socket.emit('error:unauthorized', { message: 'Authentication required to join conversation rooms' });
      } catch (err) {
        console.error('[Socket Join Error]:', err);
      }
    });

    socket.on('leave:conversation', (conversationId: string) => {
      socket.leave(`conv:${conversationId}`);
    });

    socket.on('typing:start', (data: { conversationId: string; senderName: string }) => {
      socket.to(`conv:${data.conversationId}`).emit('typing:indicator', {
        conversationId: data.conversationId,
        senderName: data.senderName,
        isTyping: true,
      });
    });

    socket.on('typing:stop', (data: { conversationId: string }) => {
      socket.to(`conv:${data.conversationId}`).emit('typing:indicator', {
        conversationId: data.conversationId,
        isTyping: false,
      });
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

export function broadcastToConversation(conversationId: string, event: string, payload: any): void {
  if (!io) return;
  io.to(`conv:${conversationId}`).emit(event, payload);
}
