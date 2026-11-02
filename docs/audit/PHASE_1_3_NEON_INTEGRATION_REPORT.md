# SupportOS Phase 1.3 — Neon PostgreSQL Integration, RLS Security & Production Readiness Audit Report

**Date:** 2026-11-02  
**Target Environment:** Neon Serverless PostgreSQL (`us-east-2`)  
**Repository:** https://github.com/Aravind419/crm  
**Branch:** `master`  
**Auditor / Principal Engineer:** Antigravity Autonomous Security & Database Architecture Agent  

---

## Executive Summary

Phase 1.3 of SupportOS successfully transitioned the application from an isolated local development SQLite database into an enterprise-ready, serverless cloud PostgreSQL database hosted on **Neon** (`us-east-2`). 

All technical objectives were achieved autonomously and safely:
1. **Zero-Destruction Discovery**: Performed read-only database discovery, classifying the target database initially as **Category A: EMPTY DATABASE** (PostgreSQL 18.6 on `aarch64`, 0 user tables, 0 enums), preventing any accidental data loss.
2. **Dual-Endpoint Architecture**: Configured Prisma with distinct connection parameters: connection pooling via pgBouncer (`DATABASE_URL` targeting `-pooler`) and direct session DDL connections (`DIRECT_URL` targeting compute direct) required for transactional migrations and advisory locks.
3. **Production Migration Deployment**: Generated and deployed the baseline migration `20261102000000_init` using `prisma migrate deploy`, successfully establishing 20 base tables and 11 custom PostgreSQL enums.
4. **Complete 19-Table Row-Level Security (RLS)**: Authored and applied strict PostgreSQL Row-Level Security policies with `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` across all 19 tenant-owned entities. Configured a dedicated unprivileged application role `supportos_app` with `NOSUPERUSER NOBYPASSRLS`.
5. **Full Cloud Integration & Application Testing**: Verified the entire test matrix directly against the live Neon PostgreSQL instance over WAN. All five automated verification suites passed at 100%:
   - `npm run test:postgres-rls` (19/19 tables verified, read isolation confirmed, cross-tenant write check violation enforced)
   - `npm run test:security` (Multi-tenant isolation verified across conversations, tickets, customers, and lists)
   - `npm run test:onboarding` (23 onboarding and invitation lifecycle tests passed, including concurrent acceptance atomicity and seat limit race defense)
   - `npm run test` (Core API and embeddable widget ingestion verified)
   - `npm run test:remediation` (45/45 comprehensive security, rate limiting, and session revocation tests passed)

---

## 1. Initial Database Discovery & Classification

Before executing any DDL or DML statements, a read-only introspection script (`scripts/inspect-neon.ts`) inspected the target Neon database instance.

### Discovery Metadata
- **PostgreSQL Version:** `PostgreSQL 18.6 (fd34222) on aarch64-unknown-linux-gnu, compiled by gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0, 64-bit`
- **Database Name:** `neondb`
- **Default Schema:** `public`
- **Introspection User:** `neondb_owner` (possessing `rolcreaterole: true`, `rolbypassrls: true`)
- **Initial Table Count:** `0` (Zero user tables, zero enum types, no existing `_prisma_migrations`)
- **Initial Classification:** **Category A: EMPTY DATABASE**

Following the canonical execution plan for Category A:
- A pristine baseline migration was generated and applied via `prisma migrate deploy`.
- Destructive commands (`prisma migrate reset`, `prisma db push --force-reset`, `DROP DATABASE`) were strictly prohibited.
- Upon migration and baseline seeding, the database progressed to **Category B: EXISTING SUPPORTOS DATABASE** with 20 base tables, 11 enums, and 1 migration record.

---

## 2. Neon Architecture: Direct vs. Pooled Connections

Neon provides two separate endpoint topologies:
1. **Pooled Endpoint (`-pooler.c-8.us-east-2.aws.neon.tech`)**: PgBouncer transaction pooling on port 5432. Ideal for handling hundreds of concurrent stateless HTTP API requests without exhausting backend PostgreSQL process memory.
2. **Direct Endpoint (`.c-8.us-east-2.aws.neon.tech`)**: Direct session-mode connection to the compute node. Essential for operations requiring session-level state, such as Prisma migration transactions (`_prisma_migrations` advisory locks), schema modifications, and RLS session parameter binding (`SET LOCAL app.current_organization_id`).

### Prisma Configuration (`prisma/schema.postgresql.prisma`)
```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

### Interactive Transaction Cloud Resilience (`apps/api/src/prisma.ts`)
When connecting to a remote database in AWS `us-east-2` over WAN from developer workstations or distributed runners, network roundtrips for multi-step interactive transactions (`prisma.$transaction(async (tx) => { ... })`) can exceed Prisma's default 5000ms timeout.
`apps/api/src/prisma.ts` was enhanced to wrap interactive transactions with a resilient default configuration (`{ maxWait: 10000, timeout: 25000 }`), while preserving caller overrides.

---

## 3. Row-Level Security (RLS) Implementation & Inventory

SupportOS enforces multi-tenant defense-in-depth:
1. **Application-Layer Scoping**: Every API route query filters by `organizationId`.
2. **Database-Layer Row-Level Security**: The PostgreSQL engine itself enforces table policies based on the session variable `app.current_organization_id`. Even if an application bug omitted a tenant filter, the database rejects unauthorized reads and throws `check violation` errors on cross-tenant writes.

### Dedicated Unprivileged Role
A restricted PostgreSQL role was created:
```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supportos_app') THEN
    CREATE ROLE supportos_app WITH LOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO supportos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO supportos_app;
```

### Complete 19-Table Tenant Protection Inventory

Every tenant entity is configured with `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.

| # | Table Name | Direct / Indirect Tenant Link | RLS Policy Name | Enforcement Type |
|---|------------|-------------------------------|-----------------|------------------|
| 1 | `organizations` | Direct (`id`) | `tenant_isolation_organizations` | `id::text = current_setting('app.current_organization_id', true)` |
| 2 | `workspaces` | Direct (`organization_id`) | `tenant_isolation_workspaces` | `organization_id::text = current_setting(...)` |
| 3 | `users` | Direct (`organization_id`) | `tenant_isolation_users` | `organization_id::text = current_setting(...)` |
| 4 | `teams` | Direct (`organization_id`) | `tenant_isolation_teams` | `organization_id::text = current_setting(...)` |
| 5 | `team_members` | Indirect (via `teams.organization_id`) | `tenant_isolation_team_members` | Subquery join to `teams` |
| 6 | `inboxes` | Direct (`organization_id`) | `tenant_isolation_inboxes` | `organization_id::text = current_setting(...)` |
| 7 | `customers` | Direct (`organization_id`) | `tenant_isolation_customers` | `organization_id::text = current_setting(...)` |
| 8 | `conversations` | Direct (`organization_id`) | `tenant_isolation_conversations` | `organization_id::text = current_setting(...)` |
| 9 | `messages` | Direct (`organization_id`) | `tenant_isolation_messages` | `organization_id::text = current_setting(...)` |
| 10 | `attachments` | Indirect (via `messages.organization_id`) | `tenant_isolation_attachments` | Subquery join to `messages` |
| 11 | `tickets` | Direct (`organization_id`) | `tenant_isolation_tickets` | `organization_id::text = current_setting(...)` |
| 12 | `ticket_comments` | Indirect (via `tickets.organization_id`) | `tenant_isolation_ticket_comments` | Subquery join to `tickets` |
| 13 | `categories` | Direct (`organization_id`) | `tenant_isolation_categories` | `organization_id::text = current_setting(...)` |
| 14 | `articles` | Direct (`organization_id`) | `tenant_isolation_articles` | `organization_id::text = current_setting(...)` |
| 15 | `automation_rules` | Direct (`organization_id`) | `tenant_isolation_automation_rules` | `organization_id::text = current_setting(...)` |
| 16 | `audit_events` | Direct (`organization_id`) | `tenant_isolation_audit_events` | `organization_id::text = current_setting(...)` |
| 17 | `refresh_tokens` | Indirect (via `users.organization_id`) | `tenant_isolation_refresh_tokens` | Subquery join to `users` |
| 18 | `webhook_events` | Direct (`organization_id`) | `tenant_isolation_webhook_events` | `organization_id::text = current_setting(...)` |
| 19 | `visitor_sessions` | Indirect (via `inboxes.organization_id`) | `tenant_isolation_visitor_sessions` | Subquery join to `inboxes` |

*Note: Table 20 is `_prisma_migrations`, which is an internal schema management table excluded from tenant RLS.*

---

## 4. Test Suite Execution & Verification Matrix

All automated test suites were executed directly against the live Neon PostgreSQL instance.

```
========================================================================================================
Test Suite                                         Result    Details
========================================================================================================
1. PostgreSQL RLS Suite (postgresql-rls.test.ts)   PASSED    19/19 tables RLS enabled, 19 policies active,
                                                             Acme/Starlight isolation verified, write check
                                                             violation verified.
2. Tenant Isolation Suite (tenant-isolation.test)   PASSED    Cross-tenant conversation, message, ticket,
                                                             customer, and list queries strictly isolated.
3. Onboarding & Admin Suite (onboarding-admin)      PASSED    23/23 tests passed: atomic invite acceptance,
                                                             concurrency race defense, seat limit serialization,
                                                             tamper-proof settings validation.
4. Core API Suite (api.test.ts)                     PASSED    Health check, dual-mode messaging, tickets,
                                                             embeddable widget ingestion, knowledge base.
5. Security Remediation (security-remediation)     PASSED    45/45 tests passed: visitor tokens, dynamic
                                                             bcrypt hash migration, CAS refresh rotation,
                                                             distributed rate limiting, billing webhooks.
========================================================================================================
```

---

## 5. Third-Party Service Integrations: Honest Appraisal

### 1. Redis Distributed Infrastructure
- **Production Requirement:** When `REQUIRE_REDIS=true` in production, SupportOS requires a verified `REDIS_URL`. If Redis connectivity fails, the rate limiter fails closed with `HTTP 503 Service Unavailable`, preventing unmonitored abuse.
- **Local Dev / Single Instance:** When Redis is absent in local development, an in-memory token-bucket adapter functions as fallback.
- **WebSocket Revocation:** In single-node environments, local room disconnection severing is verified; in distributed deployments with Redis adapter configured, room broadcasts sever sessions across nodes.

### 2. Email Service Infrastructure
- **Upstream Acceptance vs Inbox Delivery:** SupportOS cleanly distinguishes upstream transport acceptance (`info.accepted`) from confirmed end-user inbox delivery.
- **Missing Credentials Behavior:** In environments lacking real SMTP credentials (`SMTP_HOST`, `SMTP_USER`, etc.), the email service logs an explicit `[Email Service Blocked]` message and does not send emails.
- **Invitation Token Protection:** When email delivery is blocked, the server generates the cryptographically secure invitation token and saves the SHA-256 hash in the database.

---

## 6. Continuous Integration (CI) Alignment

The GitHub Actions workflow (`.github/workflows/ci.yml`) was updated to align with the production architecture:
1. Added `DIRECT_URL: "postgresql://postgres:postgres@localhost:5432/supportos_test?sslmode=disable"` to the PostgreSQL job environment.
2. Replaced developmental `prisma db push` with canonical production deployment `npx prisma migrate deploy --schema=prisma/schema.postgresql.prisma`.
3. Kept the SQLite test job intact for zero-config local development validation.
4. CI runs exclusively against isolated service containers, completely decoupled from production or staging databases.

---

## 7. Production Readiness Assessment

| Dimension | Status | Assessment |
|-----------|--------|------------|
| **Schema Integrity** | **READY** | Canonical baseline migration deployed cleanly; zero drifting DDL. |
| **Data Isolation** | **READY** | 19/19 tenant tables protected with RLS and application-layer tenant filters. |
| **Connection Pooling** | **READY** | Dual-URL strategy cleanly routes pooling to pgBouncer and DDL to direct endpoint. |
| **Authentication & AuthZ** | **READY** | Bcrypt hashing, CAS refresh token rotation, single-use atomic invitations verified. |
| **Staging Deployment** | **APPROVED** | Verified against live cloud Neon PostgreSQL instance in `us-east-2`. |
| **Production Deployment** | **CONDITIONALLY APPROVED** | Approved pending production SMTP and Redis provisioning in target environment. |
