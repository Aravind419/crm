# SupportOS — Multi-Tenant Isolation Architecture & Verification

## Architecture Overview

SupportOS employs a multi-tenant shared-process architecture with strict logical database partitioning. Every tenant-owned resource is tagged with an immutable `organizationId` foreign key referencing the `organizations` table.

---

## 1. Tenant Resolution & Context Injection

1. **Token Authentication**:
   When an agent makes an authenticated API request, `authMiddleware` validates the JWT bearer token, extracts `userId` and `organizationId`, and attaches the decoded identity to `req.user`.
2. **Tenant Isolation Guard**:
   The `tenantIsolationGuard` middleware validates that `req.user.organizationId` exists and sets `req.organizationId`. Any request lacking a valid organization context is rejected with `401 Unauthorized` or `403 Forbidden`.

---

## 2. Query Filtering & Scoping Standards

All queries executed against Prisma models must include `organizationId` in their `where` clause:

```typescript
// Correct Scoped Read Pattern
const conversation = await prisma.conversation.findFirst({
  where: {
    id: conversationId,
    organizationId: req.organizationId!, // Mandatory tenant boundary
  },
});
if (!conversation) {
  res.status(404).json({ error: 'Not Found', message: 'Conversation not found' });
  return;
}
```

By returning `404 Not Found` rather than `403 Forbidden` on resource ID lookups, the system avoids leaking resource existence across tenant boundaries.

---

## 3. Defense-in-Depth: Cross-Tenant Foreign Key Validation

A common vulnerability in multi-tenant SaaS systems is **Cross-Tenant Foreign Key Tampering**, where an authenticated user of Tenant A references an ID belonging to Tenant B inside a payload (e.g. assigning Tenant B's agent or customer to Tenant A's ticket).

SupportOS enforces multi-entity preflight verification before any relational mutation is committed:

### A. Ticket Creation (`POST /api/v1/tickets`)
- **Customer Ownership Check**:
  ```typescript
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, organizationId },
  });
  if (!customer) {
    return res.status(400).json({ error: 'Bad Request', message: 'Customer does not belong to your organization' });
  }
  ```
- **Assignee Ownership Check**: Verifies `assigneeId` exists within `organizationId`.
- **Team Ownership Check**: Verifies `teamId` exists within `organizationId`.
- **Conversation Ownership Check**: Verifies `conversationId` belongs to `organizationId`.

### B. Conversation Management (`PATCH /api/v1/conversations/:id`)
- Verifies target conversation belongs to caller's `organizationId`.
- If updating `assigneeId`, verifies target user is an active member of `organizationId`.
- If updating `teamId`, verifies target team belongs to `organizationId`.

### C. Team Membership Assignment (`POST /api/v1/teams`)
- Verifies that all `memberUserIds` passed in the array belong to `req.organizationId`. Rejects cross-tenant team member addition with `400 Bad Request`.

### D. Knowledge Base Article Authoring (`POST /api/v1/knowledge-base/articles`)
- Verifies that `categoryId` belongs to `organizationId`.

---

## 4. Database-Level Isolation & PostgreSQL RLS Readiness

While local development runs SQLite for zero-dependency rapid testing, the production architecture specifies PostgreSQL (`prisma/schema.postgresql.prisma`).

For production deployments, Row-Level Security (RLS) policies enforce database-level isolation:

```sql
-- PostgreSQL Row Level Security Policy Specification
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON conversations
  FOR ALL
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);
```

---

## 5. Automated Verification Results

The automated tenant isolation security suite (`apps/api/tests/tenant-isolation.test.ts` and `apps/api/tests/security-remediation.test.ts`) verifies:
- Cross-tenant conversation read denied (HTTP 404)
- Cross-tenant message insertion denied (HTTP 404)
- Cross-tenant customer profile lookup and update denied (HTTP 404)
- Cross-tenant ticket modification denied (HTTP 404)
- Cross-tenant agent reassignment rejected (HTTP 400)
- List queries across all entities proven strictly partitioned with zero data bleeding.
