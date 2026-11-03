# SupportOS Phase 1.5.3.2: Maintenance Process Identity & Read-Only Lookup Verification Audit Report

**Date**: 2026-11-03  
**Status**: VERIFIED & PRODUCTION READY  
**Classification**: Enterprise Application Security & Database Architecture Audit  

---

## Executive Summary

Phase 1.5.3.2 enforces strict separation between the normal HTTP server process and dedicated maintenance/migration processes, and establishes complete read-only protection for pre-authentication lookups.

Previously, administrative mode relied upon an environment flag (`SUPPORTOS_MAINTENANCE_PROCESS=true`), which could theoretically be inherited or set within the HTTP server environment. Furthermore, read-only lookups relied on a blacklist of write methods.

In Phase 1.5.3.2:
1. **Process Identity Invariant**: The application HTTP server marks its process runtime via `markAsServerProcess()`. Any invocation of `runInAdminMode` within an active server process fails closed immediately, regardless of environment flags.
2. **Dedicated Credential Boundary**: Direct administrative database credentials (`DIRECT_URL`) are strictly required for administrative maintenance operations and rejected if used as the runtime `DATABASE_URL` in production or within the server process.
3. **Positive Allowlist Read-Only Guard**: `executeReadOnlyLookup` enforces a strict positive allowlist of 8 read methods (`findUnique`, `findUniqueOrThrow`, `findFirst`, `findFirstOrThrow`, `findMany`, `count`, `aggregate`, `groupBy`). All mutation methods, raw executions, nested writes, and connection escaping methods fail closed.
4. **Engine-Level Verification**: In PostgreSQL, `SET TRANSACTION READ ONLY` is executed and verified via `SELECT current_setting('transaction_read_only') === 'on'`.
5. **Sanitized Pre-Auth Contract**: Pre-authentication and resolution lookups never expose password hashes, token hashes, or unnecessary customer data.

---

## 1. Maintenance Process Architecture & Process Identity

### 1.1 Invariant Enforcement
An environment variable alone cannot be trusted to establish maintenance process identity. An attacker or misconfiguration could set `SUPPORTOS_MAINTENANCE_PROCESS=true` on the web server.

To guarantee that the web server process cannot execute administrative tasks:
- `apps/api/src/process-identity.ts` tracks process identity via module-scoped state (`isServerProcessActive()`).
- `apps/api/src/server.ts` calls `markAsServerProcess()` during initialization before listening on any port or mounting middleware.
- `runInAdminMode()` in `apps/api/src/admin-prisma.ts` inspects `isServerProcessActive()`. If `true`, the operation is aborted with `[Administrative Access Denied] Administrative database access is strictly prohibited within the HTTP server process, regardless of environment flags.`

### 1.2 Execution Context Check Hierarchy in `runInAdminMode`
Before any administrative query can execute, four strict gating checks are evaluated in sequence:
1. **Descriptive Reason**: Non-empty string with at least 5 characters explaining the maintenance task.
2. **Tenant Context Isolation**: Rejects execution if currently within `tenantStorage.getStore()` (`AGENT`, `VISITOR`, `TENANT`).
3. **HTTP Request Context Isolation**: Rejects execution if currently executing an HTTP request (`isHttpRequestActive()`).
4. **Server Process Identity**: Rejects execution if `isServerProcessActive()` is `true`.

### 1.3 Offline Maintenance Subprocesses
Legitimate maintenance operations (migrations, initial seeding, system repairs) run strictly in dedicated offline processes:
- `npx tsx scripts/provision-roles.ts`
- `npx tsx prisma/seed.ts`
- Dedicated CLI maintenance runners

Structured audit events (`ADMIN_MAINTENANCE_OPERATION_START`, `ADMIN_MAINTENANCE_OPERATION_SUCCESS`, `ADMIN_MAINTENANCE_OPERATION_FAILURE`) are emitted for every administrative operation with database credentials and passwords sanitized.

---

## 2. Credential Boundaries (`DATABASE_URL` vs `DIRECT_URL`)

SupportOS enforces strict separation between application runtime credentials and administrative maintenance credentials:
- **`DATABASE_URL`**: Used by the standard web server process. In PostgreSQL environments, it must connect using the unprivileged `supportos_app` role through connection poolers (Neon).
- **`DIRECT_URL`**: Reserved exclusively for dedicated offline maintenance tasks (role provisioning, schema migrations). Connects using `supportos_admin`.

### Guard against Credential Substitution:
In `apps/api/src/prisma.ts`:
```typescript
if (
  (process.env.NODE_ENV === 'production' || isServerProcessActive()) &&
  process.env.DIRECT_URL &&
  process.env.DATABASE_URL &&
  process.env.DATABASE_URL.trim() === process.env.DIRECT_URL.trim()
) {
  throw new Error(
    '[Security Violation] Runtime DATABASE_URL must not match DIRECT_URL. Direct database connection credentials are reserved exclusively for dedicated maintenance processes.'
  );
}
```
In `apps/api/src/admin-prisma.ts`:
If `DIRECT_URL` specifies `supportos_app`, administrative access is denied.

---

## 3. Read-Only Lookup Guard Completeness (`executeReadOnlyLookup`)

### 3.1 Positive Allowlist of Permitted Operations
Instead of blacklisting known mutating methods, `executeReadOnlyLookup` allows ONLY the following 8 query methods:
- `findUnique`
- `findUniqueOrThrow`
- `findFirst`
- `findFirstOrThrow`
- `findMany`
- `count`
- `aggregate`
- `groupBy`

Any other method (e.g. `create`, `createMany`, `createManyAndReturn`, `update`, `updateMany`, `updateManyAndReturn`, `upsert`, `delete`, `deleteMany`, or any custom mutation) throws `[Read-Only Lookup Violation] Database operation "<name>" is strictly prohibited in authentication lookup service.`

### 3.2 Argument Inspection for Nested Writes
Permitted read methods cannot be abused with nested mutating argument payloads. All arguments passed into permitted methods are recursively checked for write payload keys:
- `data`, `create`, `createMany`, `createManyAndReturn`, `update`, `updateMany`, `updateManyAndReturn`, `upsert`, `delete`, `deleteMany`, `connectOrCreate`

If any prohibited key is detected in the argument hierarchy, an exception is raised immediately before the database query is sent.

### 3.3 Scope-Escaping and Raw Execution Guards
The transaction client returned to the lookup function strictly blocks:
- `$transaction`: Throws `[Read-Only Lookup Violation] Nested or escaping transactions ($transaction) are prohibited in read-only lookups.`
- `$connect`, `$disconnect`: Throws `[Read-Only Lookup Violation] Connection management is prohibited in read-only lookups.`
- `$executeRaw`, `$executeRawUnsafe`, `$queryRawUnsafe`: Throws `[Read-Only Lookup Violation] Raw execution method is prohibited.`
- `$queryRaw`: Inspected for mutating SQL keywords (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `CREATE`, `REPLACE`, `GRANT`, `REVOKE`, `VACUUM`, `ATTACH`, `DETACH`) and must start with `SELECT`, `SHOW`, `WITH`, or `EXPLAIN`.

---

## 4. Database Engine Verification: PostgreSQL vs SQLite

| Feature | PostgreSQL | SQLite |
| :--- | :--- | :--- |
| **Engine Transaction Mode** | `SET TRANSACTION READ ONLY` | N/A (shared file connection in WAL mode) |
| **Engine State Verification** | `SELECT current_setting('transaction_read_only') === 'on'` | Documented limitation; enforced via application proxy |
| **Application Layer Allowlist** | Active (8 permitted read methods) | Active (8 permitted read methods) |
| **Nested Write Argument Inspection**| Active | Active |
| **Raw Mutating Query Inspection** | Active | Active |
| **Database Fail-Closed Enforcement** | Engine throws `cannot execute INSERT in read-only transaction` | Application proxy intercepts and prevents writes |

---

## 5. Authentication Lookup Contract (`auth-lookup.service.ts`)

| Helper Method | Purpose | Fields Exposed | Fields Excluded / Redacted | Input Validation |
| :--- | :--- | :--- | :--- | :--- |
| `lookupUserByEmail` | Agent login bootstrap | `id`, `organizationId`, `email`, `passwordHash` (needed for verify), `firstName`, `lastName`, `role`, `status`, `isAvailable`, `avatarUrl`, `org*` | Excludes customer fields, tokens, invitation hashes | Email 3..255 chars, regex `@` |
| `lookupRefreshToken` | Session refresh / rotation | `id`, `userId`, `familyId`, `revoked`, `expiresAt`, `rotatedAt`, `organizationId`, `userStatus`, `email`, `role` | Excludes `tokenHash`, `passwordHash` | Hex SHA-256 (64 chars `^[a-f0-9]{64}$`) |
| `lookupUserByInvitation` | Agent invitation preview | `id`, `organizationId`, `email`, `firstName`, `lastName`, `role`, `status`, `invitationExpiresAt`, `org*` | Excludes `passwordHash`, `invitationTokenHash` | Hex SHA-256 (64 chars `^[a-f0-9]{64}$`) |
| `lookupOrgBySlug` | Public routing / uniqueness | `id`, `name`, `slug` | Excludes billing secrets, webhook secrets | Alphanumeric 1..100 `^[a-z0-9-]+$` |
| `lookupInboxByKey` | Widget styling & tenant | `id`, `organizationId`, `workspaceId`, `name`, `channelType`, `widgetColor`, `greeting`, `allowedOrigins`, `org*` | Excludes webhook secrets, credentials | Alphanumeric 1..128 chars |
| `lookupVisitorSession` | Web visitor verification | `id`, `inboxId`, `customerId`, `conversationId`, `expiresAt`, `revokedAt`, `organizationId` | Excludes `tokenHash`, customer PII | Hex SHA-256 (64 chars `^[a-f0-9]{64}$`) |
| `lookupOrgByRecord` | Resolve tenant by record ID | `organizationId` string | Only returns resolved tenant ID or `null` | Table allowlist (19 tables), ID 1..128 `^[a-zA-Z0-9_-]+$` |

---

## 6. Test Verification & Regression Test Summary

All test suites were executed and verified locally:

1. **Multi-Tenant Isolation & Maintenance Boundary Test Suite** (`npm --prefix apps/api run test:security`):
   - **10.1**: HTTP server cannot enable admin mode with `SUPPORTOS_MAINTENANCE_PROCESS=true` (PASS)
   - **10.2**: Agent and visitor contexts cannot access admin operations (PASS)
   - **10.3**: Admin client available only outside the server process; error output sanitized (PASS)
   - **10.4**: All 7 Prisma write APIs (`create`, `createMany`, `update`, `updateMany`, `upsert`, `delete`, `deleteMany`) rejected (PASS)
   - **10.5**: Nested write arguments (`data`, `connectOrCreate`, `create`, `update`) rejected across read APIs (PASS)
   - **10.6**: Raw SQL `INSERT`, `UPDATE`, `DELETE`, and DDL rejected (PASS)
   - **10.7**: PostgreSQL `transaction_read_only` engine verification tested (PASS)
   - **10.8**: SQLite read-only proxy behavior tested and engine limitations documented (PASS)
   - **10.9**: Authentication outputs strictly exclude sensitive fields (`tokenHash`, `passwordHash`) (PASS)
   - **10.10**: Concurrent authentication lookups remain isolated without cross-tenant leakage (PASS)
   - **Total Suite Status**: 100% PASSED (0 data leaks detected).

2. **Core API Integration Suite** (`npm --prefix apps/api test`):
   - 9 test stages passed.

3. **Rigorous Security Remediation Suite** (`npm --prefix apps/api run test:remediation`):
   - 45 of 45 test cases passed.

4. **Onboarding & Administration Phase 1 Suite** (`npm --prefix apps/api run test:onboarding`):
   - 23 of 23 test cases passed.

5. **Type Safety & Build Verification**:
   - `apps/api`: TypeScript compilation (`tsc`) succeeded with 0 errors.
   - `apps/web`: Next.js 15 production build (`next build`) succeeded with 0 errors.
   - Workspace audit check (`npm run audit:check`): 0 vulnerabilities.
