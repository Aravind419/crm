# SupportOS Implementation Roadmap & Task Breakdown

## 1. Phased Delivery Overview

The project is structured into controlled, sequential milestones to guarantee stability, security, and rigorous verification at each stage.

```
Milestone 1: Project Scaffolding, Data Layer & Auth Engine
Milestone 2: Multi-Tenant Core, Inboxes & Real-Time Gateway
Milestone 3: Shared Inbox & Conversation Engine (Agent Workspace)
Milestone 4: Structured Ticket Lifecycle & Operations
Milestone 5: Embeddable Website Live Chat Widget
Milestone 6: Customer CRM & Knowledge Base Portal
Milestone 7: Automation Rules & Reporting Analytics
Milestone 8: End-to-End Testing, Security Audits & Launch Preparation
```

---

## 2. Milestone Breakdown & Detailed Task Specifications

### Milestone 1: Project Scaffolding, Data Layer & Auth Engine
- [ ] Initialize monorepo or modular clean architecture with TypeScript.
- [ ] Setup NestJS backend with configuration module, validation pipes, and Prisma ORM.
- [ ] Design complete Prisma schema (Organizations, Users, Inboxes, Conversations, Messages, Tickets, etc.).
- [ ] Implement database migration and initial seed scripts with realistic test data.
- [ ] Implement Auth Module:
  - User Registration (`/api/v1/auth/signup`)
  - User Login (`/api/v1/auth/login`) with Argon2id hashing and JWT issuance
  - Current User Profile (`/api/v1/auth/me`)
  - Role-based Access Control (`RolesGuard`)
  - Tenant context injection (`TenantIsolationGuard`).

### Milestone 2: Multi-Tenant Core, Inboxes & Real-Time Gateway
- [ ] Implement Organizations & Workspaces API (CRUD, settings, domain settings).
- [ ] Implement Team Management API (create teams, add/remove team members).
- [ ] Implement Inboxes API (create Web Widget inbox, generate public inbox keys).
- [ ] Setup Socket.IO gateway with JWT authentication and room-based scoping:
  - Room `org:{organizationId}` for agent notifications.
  - Room `conv:{conversationId}` for conversation thread streaming.

### Milestone 3: Shared Inbox & Conversation Engine (Agent Workspace)
- [ ] Build conversation endpoints:
  - List conversations with filters (`status`, `assigneeId`, `teamId`, `search`)
  - Get conversation detail with chronological message history
  - Post message (Public Reply vs Internal Note)
  - Update conversation status (`OPEN`, `PENDING`, `RESOLVED`)
  - Update assignment (Agent ID, Team ID)
  - Update priority (`LOW`, `MEDIUM`, `HIGH`, `URGENT`).
- [ ] Build modern Next.js Agent Workspace UI:
  - 3-pane responsive layout
  - Quick view filters (All, Mine, Unassigned, Resolved)
  - Real-time conversation thread with optimistic message updates
  - Dual-mode composer (Public Reply vs Internal Note toggle)
  - Customer information side panel.

### Milestone 4: Structured Ticket Lifecycle & Operations
- [ ] Implement Tickets API:
  - Convert conversation to ticket (`/api/v1/tickets`)
  - Auto-generate sequential ticket numbers (`TICK-1001`)
  - Manage ticket status (`NEW`, `OPEN`, `PENDING`, `ON_HOLD`, `RESOLVED`, `CLOSED`)
  - Priority and due date updates
  - Ticket list with search and filtering.
- [ ] Build Tickets UI in Agent Workspace with status badges, assignee pills, and SLA countdowns.

### Milestone 5: Embeddable Website Live Chat Widget
- [ ] Implement Public Widget API (`/api/v1/public/*`):
  - Get inbox configuration (`/inbox-config`)
  - Create/continue visitor conversation (`/conversations`)
  - Send visitor message & fetch message stream
  - Visitor socket room subscription.
- [ ] Develop standalone client widget (`supportos.js`):
  - Lightweight DOM injection with zero dependencies
  - Floating trigger button with unread counter
  - Responsive chat drawer with welcome screen and pre-chat form
  - Real-time WebSocket connection to backend
  - LocalStorage session persistence.
- [ ] Test widget embedding on an example HTML page.

### Milestone 6: Customer CRM & Knowledge Base Portal
- [ ] Implement Customers API:
  - Customer directory with search and pagination
  - Customer detail view with linked conversation and ticket history
  - Customer custom attributes updater.
- [ ] Implement Knowledge Base API:
  - Category and article CRUD
  - Publish / Draft lifecycle
  - Public search endpoint.
- [ ] Build Public Knowledge Base Portal (`/portal/[slug]`):
  - Clean responsive customer-facing help center
  - Instant category navigation and article reader with breadcrumbs.

### Milestone 7: Automation Rules & Reporting Analytics
- [ ] Implement Automation Engine:
  - Rule model with triggers, condition predicates, and actions
  - Event listener evaluating rules on conversation creation
  - Action executor: auto-assignment, auto-tagging, canned reply.
- [ ] Implement Reporting API & Dashboard UI:
  - Metric aggregates: Total, Open, Resolved counts, Average First Response Time
  - Volume trends over time
  - Agent performance leaderboard.

### Milestone 8: End-to-End Testing, Security Audits & Launch Preparation
- [ ] Implement automated integration tests:
  - Multi-tenant boundary test: Proving Org A cannot access Org B data.
  - Auth test: Unauthenticated requests blocked.
  - Conversation & Ticket lifecycle tests.
- [ ] Perform security review: SQL injection check, XSS sanitation check, rate limiting verification.
- [ ] Create comprehensive documentation:
  - `README.md`
  - `DEVELOPMENT.md`
  - `ARCHITECTURE.md`
  - `CHANGELOG.md`
  - OpenAPI/Swagger API documentation.
- [ ] Production readiness checklist and deployment guides.
