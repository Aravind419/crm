# SupportOS — Enterprise Customer Support SaaS Platform

> **A modern, multi-tenant customer support and ticketing platform built for mid-market, B2B SaaS, and high-growth businesses.**

SupportOS combines the real-time engagement speed of Intercom with the operational rigor and ticket lifecycle governance of Zendesk, delivered on an independent, modern TypeScript stack.

---

## Key Capabilities

- **Multi-Tenant Workspaces**: Strict logical isolation with tenant-scoped authentication, permissions, and data querying.
- **Unified Real-Time Inbox**: Three-pane agent workspace with sub-second message streaming, typing indicators, and status filtering (`All`, `Mine`, `Unassigned`, `Resolved`).
- **Internal Collaboration**: Private agent notes (yellow card indicator) with peer mentions alongside public customer replies.
- **Structured Ticket Lifecycle**: Convert conversations to tickets (`TICK-1001`), assign priorities (`Low`, `Medium`, `High`, `Urgent`), statuses (`New`, `Open`, `Pending`, `Resolved`), and track resolution due dates.
- **Embeddable Website Chat Widget (`supportos.js`)**: Standalone, zero-dependency embeddable script with floating launcher, responsive chat window, and real-time visitor streaming.
- **Customer CRM**: Complete customer profiles, chronological conversation history, and extensible custom metadata attributes.
- **Public Knowledge Base**: Customer-facing self-service help center with category navigation, full-text search, and markdown article rendering.
- **Automation Engine**: Event-driven Trigger-Condition-Action (TCA) engine for automated routing, auto-tagging, and canned responses.
- **Operations & Reporting Dashboard**: Overview metrics (Volume, Open/Resolved queues, Average First Response Time) and agent productivity analytics.

---

## Technology Stack

- **Backend**: NestJS (TypeScript), REST API, OpenAPI / Swagger, Socket.IO real-time gateway.
- **Database & ORM**: PostgreSQL / SQLite, Prisma ORM with relational integrity and compound indexes.
- **Frontend**: Next.js (App Router), React 19, TypeScript, Tailwind CSS, Lucide Icons.
- **Real-Time Communication**: Socket.IO bi-directional WebSocket streaming with room-based scoping (`org:{id}`, `conv:{id}`).
- **Security**: Argon2id / bcrypt password hashing, JWT HttpOnly sessions, Role-Based Access Control (`Owner`, `Admin`, `Agent`), strict tenant isolation guards.

---

## Directory Structure

```
crm/
├── apps/
│   ├── api/                # NestJS Backend API & Real-time WebSocket server
│   └── web/                # Next.js Agent Workspace, Admin & Public Help Center
├── packages/
│   └── widget/             # Standalone embeddable website live chat widget (supportos.js)
├── docs/
│   └── research/           # Reverse engineering findings, architecture & security specs
├── prisma/                 # Prisma schema, migrations, and seeders
├── README.md               # Product overview and documentation
├── DEVELOPMENT.md          # Local development and setup instructions
├── ARCHITECTURE.md         # Technical architecture and domain boundaries
└── CHANGELOG.md            # Release log and milestone history
```

---

## License

Proprietary commercial software. All rights reserved. Independently designed and authored clean-room implementation.
