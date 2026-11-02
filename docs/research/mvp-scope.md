# SupportOS MVP Scope & Functional Boundaries

## 1. Executive Definition of MVP

The SupportOS Minimum Viable Product (MVP) delivers a complete, commercial-grade, multi-tenant customer support platform that mid-market businesses, IT teams, and SaaS companies can run immediately to provide live chat and ticketing support.

---

## 2. In-Scope Modules & Capabilities (MVP)

### 2.1 Multi-Tenant Organization & Workspace Core
- Organization registration & onboarding.
- Workspaces representing distinct brands/departments.
- User authentication with secure sessions (Owner, Admin, Agent).
- Team management (e.g. "Customer Success", "Technical Support") and member assignment.
- Secure agent invitation system.

### 2.2 Shared Real-Time Support Inbox
- Unified conversation feed with multi-tab filtering:
  - `All Open`, `Assigned to Me`, `Unassigned`, `Resolved`.
- Real-time bi-directional messaging stream powered by WebSockets (Socket.IO).
- Conversation metadata inspector: status changer, priority selector, tags, team/agent assignment.
- Dual-mode composer:
  - **Public Reply** (delivered to customer).
  - **Internal Note** (private yellow card visible only to agents).
- Typing indicators and message timestamp tracking.

### 2.3 Ticket Escalation & Management
- One-click conversation to structured ticket escalation.
- Sequential ticket numbering (`TICK-1001`).
- Status progression: `New` -> `Open` -> `Pending` -> `On-Hold` -> `Resolved` -> `Closed`.
- Priority classification: `Low`, `Medium`, `High`, `Urgent`.
- Due date setting and assignee ownership.
- Dedicated `/tickets` list view with filtering and search.

### 2.4 Embeddable Website Chat Widget (`supportos.js`)
- Zero-dependency embeddable script.
- Floating launcher button + clean responsive modal dialog.
- Tenant inbox key binding (`data-inbox-key="inbox_..."`).
- Visitor onboarding form (Name, Email, Message).
- Real-time message streaming between visitor and agent workspace.
- Offline and welcome greetings.

### 2.5 Customer Profile Management (CRM)
- Customer directory with search by name and email.
- Detailed customer profile view with interaction history.
- Custom metadata attributes view (e.g., plan, company, phone).
- Internal customer notes.

### 2.6 Knowledge Base / Self-Service Help Center
- Category creation and ordering.
- Rich-text / Markdown article authoring with `Draft` vs `Published` state.
- Public customer portal route (`/portal/[workspace-slug]`).
- Instant keyword search across published articles.

### 2.7 Automation Engine (Foundations)
- Event triggers: `conversation.created`.
- Condition evaluator: Keywords in initial message.
- Actions: Auto-assign team/agent, set priority, send automated greeting.

### 2.8 Reporting & Operations Dashboard
- Executive metrics cards:
  - Total Conversations, Open Conversations, Resolved Conversations.
  - Average First Response Time (FRT) in minutes.
- Daily conversation volume graph (Incoming vs Resolved).
- Agent performance table (Assigned vs Resolved count).

---

## 3. Explicitly Out-of-Scope for MVP (Deferred to Phase 2/3)

1. **Third-party Social Inboxes**: WhatsApp Cloud API, Instagram DM, Facebook Messenger (deferred to Phase 2).
2. **Inbound Email IMAP/POP3 Parser**: Handled initially via public REST webhook / API; full email server sync deferred to Phase 2.
3. **Voice / WebRTC Calling**: Out of scope for text-based support MVP.
4. **SAML 2.0 / SCIM Enterprise SSO**: Deferred to Enterprise milestone.
5. **Multi-brand billing segregation**: Single consolidated billing per organization in MVP.
