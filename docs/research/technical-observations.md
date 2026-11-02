# Technical Observations & Reverse Engineering Register

## 1. Scope & Methodology

This register documents structural, protocol, and architectural observations collected across Intercom, Zendesk, and Chatwoot.
All inspections were conducted non-invasively through publicly exposed network protocols, publicly accessible user interfaces, published API specifications, and public technical documentation.

---

## 2. REA Evidence Register

| ID | Reference Product | Module | Observable Feature / Behavior | Evidence Type | Evidence Location | Confidence | Limitation / Note |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **EV-01** | Chatwoot | Widget Ingestion | Client loads `packs/js/sdk.js`; passes `websiteToken`. Sends POST to `/api/v1/widget/conversations` with visitor attributes. | Network & DOM Inspection | `https://www.chatwoot.com` / Help Center docs | High | Uses ActionCable websocket connection for live bi-directional sync. |
| **EV-02** | Chatwoot | Identity Verification | Verifies contact identity via `identifier_hash` computed as HMAC-SHA256 of identifier with secret token. | Documentation & API | Chatwoot API documentation / Security docs | High | Prevents identity spoofing across shared browser sessions. |
| **EV-03** | Intercom | Help Center & AI Bot | Fin AI agent searches vector database and knowledge articles; generates suggested responses with source pill citations. | Product UI & Network | `https://fin.ai/` & `intercom.com/helpdesk` | High | Proprietary LLM fine-tuning behind private API gateway. |
| **EV-04** | Intercom | Shared Inbox | Three-pane responsive layout with keyboard shortcuts (`e` to close, `r` to reply, `a` to assign). | Public UI | `https://www.intercom.com/helpdesk/inbox` | High | High frontend state complexity managed via modern React virtualized lists. |
| **EV-05** | Zendesk | Ticket State Machine | Strict ticket statuses (`New`, `Open`, `Pending`, `On-hold`, `Solved`, `Closed`). Cannot reopen `Closed` tickets; triggers follow-up ticket. | Documentation & REST API | Zendesk Support API Reference (`/api/v2/tickets`) | High | Industry-standard ticket state progression. |
| **EV-06** | Zendesk | SLA Policies | Metrics evaluated against Business Hours calendar vs Calendar Hours. Tracks First Reply Time and Next Reply Time. | Documentation | Zendesk Admin Guides / SLA Management | High | Complex calendar-aware deadline calculator engine required. |
| **EV-07** | Zendesk | Agent Workspace | Merged chat, email, and social tickets into single composer with toggle between "Public reply" and "Internal note". | Product UI & Guides | Zendesk Agent Workspace documentation | High | Standard enterprise collaboration pattern. |
| **EV-08** | Intercom | Webhook Dispatch | HTTP webhooks signed with `X-Hub-Signature` header (SHA1 or SHA256 HMAC) for webhook payload verification. | Developer Documentation | Intercom Developer Hub / Webhook docs | High | Essential security standard for external integrations. |

---

## 3. Architectural Inferences & Learnings for SupportOS

1. **Unified Storage for Conversations & Tickets**:
   - Rather than treating conversations and tickets as disconnected silos, SupportOS should link them through a clean relational model where a `Ticket` optionally references a parent `Conversation`.
   
2. **Real-Time Layer**:
   - Chatwoot uses Rails ActionCable; Intercom uses proprietary WebSockets/Pusher; Zendesk uses PubNub/Pusher.
   - For SupportOS, a high-performance **Socket.IO** server paired with **Redis Pub/Sub** provides optimal horizontal scalability, automatic reconnection, room-based tenant scoping (`org:{id}`, `conv:{id}`), and fallback support.

3. **Public Widget Security**:
   - The embeddable widget must communicate only via a public-safe API endpoint using an `inbox_key`.
   - Never expose organization secrets, internal agent notes, or internal user emails in public widget API responses.
   - Attachments uploaded via widget must be validated for MIME type, sanitized, and stored with unique randomized UUID keys.

4. **Multi-Tenant Database Design**:
   - While Chatwoot provides single-tenant on-premise and multi-account cloud configurations, enterprise B2B SaaS requires strict per-tenant isolation in every SQL query.
   - SupportOS will enforce `organization_id` on all workspace data models with foreign keys and compound indexes (`organization_id`, `created_at`).
