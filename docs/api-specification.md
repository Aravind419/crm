# SupportOS API Specification (REST + WebSocket)

Base URL: `http://localhost:4000/api/v1`

## 1. Authentication Endpoints

### `POST /auth/signup`
Creates a new tenant organization, owner user, default workspace, and default inbox.
- **Request Body**:
  ```json
  {
    "orgName": "Acme Technologies",
    "orgSlug": "acme",
    "email": "alex@acme.com",
    "password": "Password123!",
    "firstName": "Alex",
    "lastName": "Chen"
  }
  ```
- **Response (201 Created)**: Returns `{ token, user, organization }`.

### `POST /auth/login`
Authenticates agent or administrator.
- **Request Body**:
  ```json
  {
    "email": "alex@acme.com",
    "password": "Password123!"
  }
  ```
- **Response (200 OK)**: Returns `{ token, user, organization }`.

### `GET /auth/me`
Returns current user profile, organization, and teams. Requires `Authorization: Bearer <token>`.

---

## 2. Conversation Endpoints

### `GET /conversations`
List conversations for authenticated tenant.
- **Query Parameters**:
  - `status`: `OPEN` | `PENDING` | `SNOOZED` | `RESOLVED`
  - `scope`: `all` | `mine` | `unassigned`
  - `search`: string

### `GET /conversations/:id`
Fetch conversation detail, customer profile, and chronological messages.

### `POST /conversations/:id/messages`
Send message as public reply or private staff note.
- **Request Body**:
  ```json
  {
    "content": "Message body text",
    "messageType": "PUBLIC_REPLY" // or "INTERNAL_NOTE"
  }
  ```

### `PATCH /conversations/:id`
Update conversation metadata (`status`, `assigneeId`, `teamId`, `priority`).

---

## 3. Ticket Endpoints

### `GET /tickets`
List tickets with filtering by status, priority, and search.

### `POST /tickets`
Create structured support ticket.
- **Request Body**:
  ```json
  {
    "conversationId": "uuid-optional",
    "customerId": "uuid-required",
    "title": "Batch Ingestion Latency",
    "description": "Webhook 504 timeouts",
    "priority": "HIGH",
    "assigneeId": "uuid-optional"
  }
  ```

### `PATCH /tickets/:id`
Update status (`NEW`, `OPEN`, `PENDING`, `ON_HOLD`, `RESOLVED`, `CLOSED`), priority, or assignee.

---

## 4. Public Embeddable Widget API

Rate-limited to 60 requests per minute per IP.

### `GET /public/inbox-config/:inboxKey`
Fetch widget styling, branding, and greetings for the specified inbox.

### `POST /public/conversations`
Visitor initiates conversation from the web widget.
- **Request Body**:
  ```json
  {
    "inboxKey": "inbox_acme_live_49f82d",
    "visitorToken": "vis_random_uuid",
    "name": "Visitor Name",
    "email": "visitor@example.com",
    "message": "Initial customer question"
  }
  ```

### `GET /public/conversations/:conversationId`
Fetch customer message stream. **Strictly filters out internal staff notes**.

### `POST /public/conversations/:conversationId/messages`
Visitor sends follow-up reply.

---

## 5. WebSocket Real-Time Gateway (Socket.IO)

- **Connection URL**: `http://localhost:4000`
- **Authentication**: JWT token in `auth.token` (for staff) or `auth.visitorToken` (for widget visitors).
- **Rooms**:
  - `org:{organizationId}`: Broadcasts global events to staff.
  - `conv:{conversationId}`: Broadcasts live thread updates.
- **Events**:
  - `message:created`: New customer reply or staff note.
  - `conversation:created`: New incoming conversation.
  - `conversation:updated`: Status, assignee, or priority changed.
  - `ticket:created`: New escalated ticket.
  - `typing:indicator`: Agent or customer typing status.
