# SupportOS Multi-Tenant Isolation Audit

## 1. Scope & Methodology

This audit evaluated tenant data segregation across:
- All database queries and schema definitions
- Server-side tenant extraction (`TenantIsolationGuard`)
- API endpoints for conversations, tickets, customers, and teams
- WebSocket room partitioning
- Cross-tenant intrusion attempts between Organization A ("Acme") and Organization B ("Starlight")

---

## 2. PostgreSQL Row-Level Security (RLS) Analysis: Claim vs. Reality

### Audit Finding
- **Claimed in Research Docs**: "PostgreSQL row-level security (RLS) is enabled and enforced."
- **Actual Reality**:
  - The local operational database engine is SQLite (`dev.db`). SQLite has no concept or support for Row-Level Security.
  - The standalone `schema.postgresql.prisma` file contains table definitions but no SQL migrations creating PostgreSQL RLS policies (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY; CREATE POLICY ...`).
- **Conclusion**:
  - SupportOS currently enforces tenant isolation at the **application and query layer** via `where: { organizationId }` in Prisma queries and `TenantIsolationGuard`.
  - While application-layer isolation is verified and passing, database-level RLS is **not currently active**.

---

## 3. Application-Level Multi-Tenant Test Execution Results

The dedicated test suite `apps/api/tests/tenant-isolation.test.ts` was executed against live tenant records:

| Test Case | Target Entity | Action | Result | Verification |
| :--- | :--- | :--- | :--- | :--- |
| **TC-01** | Global Feed | Unauthenticated request to `/api/v1/conversations` | **401 Unauthorized** | Passed |
| **TC-02** | Starlight Conv | Acme agent requests Starlight conversation | **404 Not Found** | Passed |
| **TC-03** | Starlight Conv | Acme agent attempts to inject message into Starlight thread | **404 Not Found** | Passed |
| **TC-04** | Starlight Customer| Acme agent requests Starlight customer profile | **404 Not Found** | Passed |
| **TC-05** | Starlight Ticket | Acme agent attempts to patch Starlight ticket | **404 Not Found** | Passed |
| **TC-06** | Conversation List | Acme agent lists conversations | **0 Starlight records leaked** | Passed |
| **TC-07** | Conversation List | Starlight owner lists conversations | **Only Starlight records returned** | Passed |

---

## 4. Recommendations for PostgreSQL Production Migration

To implement true defense-in-depth database RLS when deploying to production PostgreSQL:
1. Execute DDL script enabling RLS on all tenant tables:
   ```sql
   ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
   CREATE POLICY tenant_isolation_policy ON conversations
     FOR ALL
     USING (organization_id = current_setting('app.current_organization_id', true)::uuid);
   ```
2. Configure a Prisma middleware or extension that executes `SET LOCAL app.current_organization_id = $orgId` on every transaction.
