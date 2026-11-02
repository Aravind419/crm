# SupportOS — WebSocket Real-Time Security Specification

## Architecture Overview

SupportOS utilizes a Socket.IO real-time event pipeline (`apps/api/src/services/socket.service.ts`) powering instant bi-directional messaging, queue updates, agent typing indicators, and presence tracking.

Because WebSocket connections can bypass standard HTTP middleware if not properly safeguarded, SupportOS enforces strict connection-level authentication, cryptographic room authorization, and private note isolation.

---

## 1. Handshake Authentication Pipeline

Every incoming WebSocket connection must authenticate during the handshake phase via the `io.use()` middleware:

```typescript
io.use(async (socket: Socket, next) => {
  // 1. Agent Authentication via JWT
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
  if (token) {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (user && user.status === 'ACTIVE' && user.organizationId === payload.organizationId) {
      socket.data.isAgent = true;
      socket.data.userId = user.id;
      socket.data.organizationId = user.organizationId;
      return next();
    }
  }

  // 2. Public Visitor Authentication via VisitorSession Token
  const visitorToken = socket.handshake.auth?.visitorToken;
  const conversationId = socket.handshake.auth?.conversationId;
  if (visitorToken && conversationId) {
    const tokenHash = crypto.createHash('sha256').update(String(visitorToken).trim()).digest('hex');
    const session = await prisma.visitorSession.findFirst({ where: { tokenHash } });
    if (session && !session.revokedAt && session.expiresAt > new Date() && session.conversationId === conversationId) {
      socket.data.isVisitor = true;
      socket.data.conversationId = conversationId;
      return next();
    }
  }

  // 3. Strict Rejection of Unauthenticated Sockets
  return next(new Error('Authentication required: Valid agent token or visitor session must be provided'));
});
```

Anonymous or unverified socket connections are terminated immediately at connection time.

---

## 2. Room Isolation Model

Sockets are grouped into scoped rooms enforcing tenant and thread boundaries:

| Room Pattern | Authorized Inhabitants | Events Dispatched |
| :--- | :--- | :--- |
| `org:{organizationId}` | Authenticated staff/agents belonging to that organization | `conversation:created`, `conversation:updated`, `ticket:created`, `ticket:updated`, `message:created` (including `INTERNAL_NOTE`) |
| `conv:{conversationId}` | Verified customer visitor and authorized agents inspecting the thread | Public replies (`PUBLIC_REPLY`), typing indicators (`typing:indicator`) |

### Explicit Room Join Defense (`join:conversation`)
When a client emits `join:conversation`, the server verifies:
1. **Agents**: Must query the database to verify `conversation.organizationId === socket.data.organizationId`. Attempted joins across tenant lines are blocked and trigger `error:unauthorized`.
2. **Visitors**: Can **only** join the exact conversation matching `socket.data.conversationId`. Attempted access to foreign visitor conversations is blocked and logged.

---

## 3. Critical Privacy Boundary: Internal Private Notes

A vital security vulnerability in multi-tenant support platforms is the leakage of internal staff notes (`INTERNAL_NOTE`) to end-user customer visitors.

SupportOS implements a hard privacy boundary in `broadcastToConversation`:

```typescript
export function broadcastToConversation(conversationId: string, event: string, payload: any): void {
  if (!io) return;

  // CRITICAL PRIVACY DEFENSE: Never deliver INTERNAL_NOTE messages to conversation rooms
  if (event === 'message:created' && payload?.messageType === 'INTERNAL_NOTE') {
    return; // Dropped from visitor-accessible socket room
  }

  io.to(`conv:${conversationId}`).emit(event, payload);
}
```

Internal notes are strictly dispatched via `broadcastToOrg(organizationId, 'message:created', payload)`, which broadcasts exclusively to authenticated agents in `org:{orgId}`. Visitors never receive private staff commentary.

---

## 4. Typing Indicator Event Sanitization

Typing indicators (`typing:start`, `typing:stop`) are validated before relay:
- Visitor sockets can only send typing indicators for their assigned conversation ID.
- Agent sockets can only send typing indicators for conversations within their organization.
- Unverified payloads are dropped without broadcast.
