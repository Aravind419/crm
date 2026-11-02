# SupportOS Database Architecture & Schema Audit

## 1. Database Engine & Source of Truth

### Current Setup
- **Development & Local Execution**: SQLite via `prisma/schema.prisma` (`DATABASE_URL="file:./dev.db"`).
- **Target Production Schema**: PostgreSQL via `prisma/schema.postgresql.prisma`.

### Audit Evaluation: SQLite vs. PostgreSQL Compatibility
- Both schemas share identical entity names, field names, foreign key relations, and compound index definitions.
- Differences:
  - SQLite schema models enums as validated strings.
  - PostgreSQL schema declares native Prisma `enum` types (`UserRole`, `ConversationStatus`, `Priority`, `Plan`).
- **Source of Truth Determination**:
  - The actual runtime source of truth in the repository today is `prisma/schema.prisma` (SQLite).
  - PostgreSQL production readiness is **prepared but unverified against a live PostgreSQL cluster**.

---

## 2. Relational Integrity & Constraint Audit

| Entity | Primary Key | Foreign Keys | Cascading Deletes | Compound Unique Constraints | Compound Indexes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `Organization` | UUID | None | Workspaces, Users, Teams, Inboxes, Conversations, Tickets | `[slug]` | None |
| `User` | UUID | `organizationId` | TeamMembers, Articles | `[organizationId, email]` | `[organizationId]` |
| `TeamMember` | UUID | `teamId`, `userId` | None | `[teamId, userId]` | None |
| `Inbox` | UUID | `organizationId`, `workspaceId` | Conversations | `[inboxKey]` | `[organizationId]` |
| `Customer` | UUID | `organizationId` | Conversations, Tickets | None | `[organizationId, email]` |
| `Conversation` | UUID | `organizationId`, `inboxId`, `customerId`, `assigneeId`, `teamId` | Messages | None | `[organizationId, status, createdAt]`, `[organizationId, assigneeId]` |
| `Message` | UUID | `organizationId`, `conversationId` | Attachments | None | `[conversationId, createdAt]` |
| `Ticket` | UUID | `organizationId`, `conversationId`, `customerId`, `assigneeId`, `teamId` | Comments | `[organizationId, ticketNumber]` | `[organizationId, status]` |
| `Article` | UUID | `organizationId`, `categoryId`, `authorId` | None | `[organizationId, slug]` | `[organizationId, status]` |

---

## 3. Migration Tracking Audit
- **Audit Defect**: The repository does NOT currently contain a `prisma/migrations` folder because database initialization was performed via `npx prisma db push`.
- **Recommendation**: Before production deployment, initialize a formal baseline migration:
  `npx prisma migrate dev --name init`
