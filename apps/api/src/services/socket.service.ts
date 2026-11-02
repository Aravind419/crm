import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import { config } from '../config';

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
      socket.data.visitorToken = visitorSession;
      socket.data.conversationId = conversationId;
      socket.data.isVisitor = true;
      return next();
    }

    // Allow connection for public polling
    next();
  });

  io.on('connection', (socket: Socket) => {
    if (socket.data.isAgent && socket.data.organizationId) {
      const orgRoom = `org:${socket.data.organizationId}`;
      socket.join(orgRoom);
      console.log(`[Socket] Agent ${socket.data.userId} connected to room ${orgRoom}`);
    }

    if (socket.data.conversationId) {
      const convRoom = `conv:${socket.data.conversationId}`;
      socket.join(convRoom);
      console.log(`[Socket] Visitor joined thread room ${convRoom}`);
    }

    // Agent or visitor joins specific conversation room to watch
    socket.on('join:conversation', (conversationId: string) => {
      socket.join(`conv:${conversationId}`);
    });

    socket.on('leave:conversation', (conversationId: string) => {
      socket.leave(`conv:${conversationId}`);
    });

    // Typing indicators
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

    socket.on('disconnect', () => {
      // Clean disconnect
    });
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
