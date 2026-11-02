# SupportOS Real-Time WebSocket Architecture Audit

## 1. Engine & Protocol Inspection
- **Technology**: Socket.IO v4.8 attached to HTTP server.
- **Client Protocol**: WebSocket with automatic HTTP long-polling fallback.
- **Transports Tested**: `['websocket', 'polling']`.

---

## 2. Room Architecture & Subscription Authorization

### Room Hierarchy
1. `org:{organizationId}`: Broadcasts operational events to staff within that organization.
   - Handshake authentication extracts JWT claims and verifies staff membership before socket joins room.
2. `conv:{conversationId}`: Broadcasts granular conversation messages and typing indicators.
   - Handshake binds visitor session or staff token.

### Security Remediation (SEC-01)
- **Pre-Remediation Flaw**: Sockets could emit `join:conversation` and join any conversation ID arbitrarily.
- **Post-Remediation Verification**:
  - Agent join attempts are validated against `prisma.conversation` with `where: { organizationId: socket.data.organizationId }`.
  - Visitor join attempts are strictly constrained to `socket.data.conversationId === targetConversationId`.
  - Unauthenticated sockets are rejected with `error:unauthorized`.

---

## 3. Real-Time Event Dictionary Verification

| Event Name | Emitter | Target Audience | Payload | Verified in Audit |
| :--- | :--- | :--- | :--- | :--- |
| `message:created` | API Server | `conv:{id}` & `org:{id}` | Full Message entity | Yes (Sub-second delivery in Web Workspace) |
| `conversation:created` | API Server | `org:{id}` | Conversation + Customer | Yes (Appears in Unassigned feed immediately) |
| `conversation:updated` | API Server | `conv:{id}` & `org:{id}` | Updated status / assignee | Yes (Status changes sync live) |
| `ticket:created` | API Server | `org:{id}` | Ticket entity | Yes |
| `typing:indicator` | Web / Widget | `conv:{id}` | `{ senderName, isTyping }`| Yes |
