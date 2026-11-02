# SupportOS Architecture & Domain Specifications

## 1. Domain Separation & Modular Boundaries

The SupportOS backend is structured around explicit domain modules:

```
apps/api/src/
├── common/
│   ├── decorators/         # @CurrentTenant(), @CurrentUser(), @Roles()
│   ├── guards/             # JwtAuthGuard, RolesGuard, TenantIsolationGuard
│   ├── filters/            # GlobalHttpExceptionFilter
│   └── interceptors/       # LoggingInterceptor
├── modules/
│   ├── auth/               # User registration, login, token refresh
│   ├── organizations/      # Tenant lifecycle, workspaces, branding
│   ├── users/              # Agent management, roles, profiles
│   ├── teams/              # Support teams & membership routing
│   ├── inboxes/            # Inboxes (Web, Email, API) & public keys
│   ├── customers/          # Customer profiles & custom attributes
│   ├── conversations/      # Real-time threads, messages & internal notes
│   ├── tickets/            # Structured tickets, priorities, statuses
│   ├── knowledge-base/     # Categories, articles & public help portal
│   ├── automations/        # Trigger-condition-action engine
│   ├── reports/            # Operational analytics & metrics
│   ├── public/             # Safe, rate-limited widget ingestion API
│   └── websockets/         # Socket.IO gateway & event dispatcher
```

---

## 2. Multi-Tenant Isolation Pattern

1. All incoming authenticated requests pass through `JwtAuthGuard` and `TenantIsolationGuard`.
2. The user's active `organizationId` is placed onto the request object (`req.organizationId`).
3. Services inject `organizationId` into every database query:
   ```typescript
   const conversation = await this.prisma.conversation.findFirst({
     where: { id: conversationId, organizationId: currentTenantId }
   });
   if (!conversation) throw new NotFoundException('Conversation not found');
   ```
4. This guarantees that direct object reference (IDOR) attacks across organizations are prevented at the database query level.

---

## 3. Real-Time Protocol Specification

SupportOS utilizes **Socket.IO** for WebSocket communication.

### Channel Rooms
- `org:{organizationId}`: Broadcasts global events to active staff (e.g., `conversation:created`, `ticket:assigned`).
- `conv:{conversationId}`: Broadcasts granular thread events (e.g., `message:created`, `agent:typing`).

### Event Dictionary
- `message:created`: New customer reply, agent response, or internal note.
- `conversation:status_changed`: Updates UI tabs immediately when a thread is resolved or reopened.
- `conversation:assigned`: Updates assignee pills without requiring page refreshes.
- `typing:status`: Emitted when user is typing in composer.
