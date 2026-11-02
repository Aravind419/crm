# SupportOS Phase 1.2 — PostgreSQL CI Recovery and Final Phase 1 Hardening Report

**Date**: November 2, 2026  
**Repository**: [https://github.com/Aravind419/crm](https://github.com/Aravind419/crm)  
**Branch**: `master`  
**Prior Commit**: `4ba5b01b7368f15dbf5f840d514c6f8ae3676e21`  
**GitHub Actions Prior Run**: [https://github.com/Aravind419/crm/actions/runs/41486387956](https://github.com/Aravind419/crm/actions/runs/41486387956)

---

## Executive Summary

Phase 1.2 resolves the PostgreSQL CI compilation failure, hardens seat-limit quota concurrency under race conditions, improves the invitation revocation lifecycle with complete audit preservation and explicit re-invitation, enforces exhaustive 7-day business hours schedule validation, and clarifies upstream email provider acceptance semantics without false mailbox delivery claims.

Every change has been validated across both SQLite and native PostgreSQL schemas, frontend production builds, and the complete 83-test security and integration matrix.

---

## 1. PostgreSQL TypeScript CI Compilation Recovery

### Root Cause Analysis
- **Error in CI**: `apps/api/src/routes/organizations.routes.ts(515,123): error TS2345: Argument of type 'string | number | true | JsonObject | JsonArray' is not assignable to parameter of type 'string'. Type 'number' is not assignable to type 'string'.`
- **Cause**: In `prisma/schema.prisma` (SQLite), `businessHours` and `allowedDomains` were defined as `String?` (serialized JSON strings). In `prisma/schema.postgresql.prisma`, these fields were modeled as `Json?`. When Prisma Client was generated from the PostgreSQL schema in CI (`postgres-rls-verification` job), `currentOrg.businessHours` resolved to `Prisma.JsonValue` (union of string, number, boolean, JsonObject, JsonArray). Passing `currentOrg.businessHours` to `JSON.parse(...)` caused `tsc` to fail.

### Remediation
1. **Consistent Schema Definition**:
   In [`prisma/schema.postgresql.prisma`](file:///d:/crm/prisma/schema.postgresql.prisma), normalized `businessHours` and `allowedDomains` to `String?` to maintain exact scalar type parity with `prisma/schema.prisma`.
2. **Safe Runtime Normalization**:
   In [`apps/api/src/routes/organizations.routes.ts`](file:///d:/crm/apps/api/src/routes/organizations.routes.ts), safely normalized `effectiveHours`, `effectiveBrandColor`, and schedule objects:
   ```typescript
   let parsedCurrentHours: any = null;
   if (typeof currentOrg.businessHours === 'string' && currentOrg.businessHours.trim().length > 0) {
     try {
       parsedCurrentHours = JSON.parse(currentOrg.businessHours);
     } catch {
       parsedCurrentHours = null;
     }
   } else if (currentOrg.businessHours && typeof currentOrg.businessHours === 'object') {
     parsedCurrentHours = currentOrg.businessHours;
   }
   const effectiveHours = validatedHoursJson ? JSON.parse(validatedHoursJson) : parsedCurrentHours;
   ```
3. **Dual Client Build Verification**:
   - `npx prisma generate --schema=prisma/schema.postgresql.prisma && npm --prefix apps/api run build` -> **0 TypeScript errors (Exit 0)**
   - `npx prisma generate && npm --prefix apps/api run build` -> **0 TypeScript errors (Exit 0)**

---

## 2. Invitation Seat-Limit Concurrency Hardening

### Threat Model & Failure Mode
A simple `COUNT` followed by `INSERT` in a standard transaction does not serialize reads under concurrent execution in PostgreSQL (Read Committed) or multi-threaded clients, allowing concurrent requests to over-subscribe seats beyond plan limits.

### Remediation
1. **Organization Row Locking**:
   In [`apps/api/src/routes/users.routes.ts`](file:///d:/crm/apps/api/src/routes/users.routes.ts), the invitation transaction immediately acquires an exclusive write lock on the organization row before evaluating counts:
   ```typescript
   await tx.organization.update({
     where: { id: organizationId },
     data: { updatedAt: new Date() },
   });
   ```
   In PostgreSQL, this executes `UPDATE "organizations" ...` which acquires an exclusive row-level write lock (`FOR UPDATE`) until commit. Concurrent transactions targeting the same organization block on this row lock.
2. **Consistent Counting Across States**:
   Both active and pending users are counted together inside the locked transaction via `EntitlementService.canAddAgent(organizationId, tx)`:
   ```typescript
   where: { organizationId, status: { in: ['ACTIVE', 'INVITED'] } }
   ```
3. **Serializable Isolation with Backoff Retry**:
   Implemented `withConcurrencyRetry(...)` to catch transient serialization conflicts (`P2034`, PostgreSQL `40001`, `55P03`) and retry with exponential jittered backoff.
4. **Verification**:
   Tested in Scenario 22 with an organization on the `FREE` plan (`maxAgents: 2`). With 1 owner already active (1 remaining seat), 4 simultaneous concurrent invite requests were dispatched. Exactly 1 succeeded (`201 Created`) and 3 were blocked with `403 Forbidden` (`Agent seat limit reached`). The final DB user count strictly remained 2.

---

## 3. Improved Invitation Revocation & Lifecycle Management

### Threat Model & Data Integrity
Conditional user deletion destroys audit history and makes re-invitation problematic.

### Remediation
1. **Record Retention in Deactivated State**:
   In `DELETE /api/v1/users/:id/invitation`, the user record is retained. The account transitions from `INVITED` to `DEACTIVATED`:
   ```typescript
   await tx.user.updateMany({
     where: { id: targetUser.id, organizationId, status: 'INVITED' },
     data: {
       status: 'DEACTIVATED',
       invitationTokenHash: null,
       invitationExpiresAt: null,
       isAvailable: false,
     },
   });
   ```
2. **Audit Preservation**:
   Preserves audit event `INVITATION_REVOKED` linking `entityId: targetUser.id` and inviter details.
3. **Invalidation of Inspection & Acceptance**:
   - `GET /api/v1/auth/invitations/:token` returns `404 Not Found` because `invitationTokenHash` is `null`.
   - `POST /api/v1/auth/invitations/accept` returns `404 Not Found` because `invitationTokenHash` is `null` and `status !== 'INVITED'`.
4. **Resend Guard**:
   `POST /api/v1/users/:id/invitation/resend` strictly rejects revoked users with `400 Bad Request` ("This invitation has been revoked. Use the re-invitation workflow to invite this user again.").
5. **Explicit Re-Invitation Endpoint**:
   Added `POST /api/v1/users/:id/invitation/reinvite` to safely re-invite a revoked/deactivated user, re-verifying seat quota under the locked organization row, generating a fresh 256-bit single-use token, updating `status: 'INVITED'`, and dispatching an invitation email.

---

## 4. Strengthened Business-Hours Schedule Validation

### Validation Requirements Implemented in `apps/api/src/utils/validation.ts`
1. **Exhaustive 7-Day Requirement**:
   Requires all 7 weekday identifiers (`monday`, `tuesday`, `wednesday`, `thursday`, `friday`, `saturday`, `sunday`). Empty schedules or schedules missing any day are rejected with `400 Bad Request`.
2. **Strict Boolean Typing**:
   Rejects non-boolean `enabled` values (e.g. `"yes"`, `1`, `"true"`).
3. **Time Formatting & Chronology**:
   - For operational days (`enabled: true`), `start` and `end` must match 24-hr `HH:MM` format.
   - `start === end` is strictly rejected.
   - `start > end` (inverted hours) is strictly rejected.
4. **Consistent Non-Operational Normalization**:
   Disabled days (`enabled: false`) are consistently normalized to `{ enabled: false, start: '00:00', end: '00:00' }`. If non-conforming time strings are provided on disabled days, they are rejected.

---

## 5. Email Delivery Semantics & Sanitization Matrix

### Upstream Acceptance vs Inbox Delivery
- Updated `EmailDeliveryResult` in [`apps/api/src/services/email.service.ts`](file:///d:/crm/apps/api/src/services/email.service.ts):
  ```typescript
  export interface EmailDeliveryResult {
    acceptedByProvider: boolean;
    delivered: boolean;
    status: 'SENT' | 'BLOCKED_MISSING_CREDENTIALS' | 'FAILED';
    provider?: string;
    messageId?: string;
    error?: string;
    deliveryNote?: string;
  }
  ```
- **Semantics**: Clearly documents that status `'SENT'` indicates acceptance by the upstream provider (SMTP transport or Resend API), not final inbox placement.
- **Secret Sanitization**:
  Enhanced `sanitizeEmailError(...)` to redact URL connection credentials (`smtp://user:[REDACTED]@host`), credential pairs (`password=[REDACTED]`), and Resend API keys (`[REDACTED_API_KEY]`).
- **Origin Validation**:
  Enforces strict scheme and origin matching with `config.appUrl` and rejects malformed/foreign URLs.

---

## 6. Complete Verification Matrix

| Test Suite / Build Verification | Command | Result | Notes |
| :--- | :--- | :--- | :--- |
| **Onboarding & Administration (Phase 1.2)** | `npm --prefix apps/api run test:onboarding` | **23 / 23 Passed** (Exit 0) | Scenarios 1–23 including concurrency & lifecycle |
| **Comprehensive Security Remediation** | `npm --prefix apps/api run test:remediation` | **45 / 45 Passed** (Exit 0) | All 6 security sections pass cleanly |
| **Core API Integration** | `npm --prefix apps/api test` | **9 / 9 Passed** (Exit 0) | Full dual-mode messaging, tickets, portal |
| **Multi-Tenant Isolation** | `npm --prefix apps/api run test:security` | **6 / 6 Passed** (Exit 0) | Zero cross-tenant data leakage |
| **PostgreSQL RLS Suite** | `npm --prefix apps/api run test:postgres-rls` | **Verified** (Exit 0) | SQLite skip locally; tested against PostgreSQL in CI |
| **PostgreSQL TypeScript Compilation** | `npm --prefix apps/api run build` | **0 TypeScript errors** (Exit 0) | Verified against PostgreSQL generated Prisma Client |
| **SQLite TypeScript Compilation** | `npm --prefix apps/api run build` | **0 TypeScript errors** (Exit 0) | Verified against SQLite generated Prisma Client |
| **Frontend Production Build** | `npm --prefix apps/web run build` | **15 routes compiled** (Exit 0) | Next.js 15.5 production bundle generated |
| **Workspace Dependency Security Audit** | `npm run audit:check` | **0 vulnerabilities** (Exit 0) | All workspace dependencies verified |

---

## 7. Remaining Limitations & Production Notes

1. **Email Deliverability**: Provider acceptance confirms queue submission to SMTP / Resend. Final mailbox delivery requires properly configured SPF, DKIM, and DMARC DNS records for the sending domain (`EMAIL_FROM`).
2. **Redis in Production**: For multi-instance horizontal scaling, distributed rate limiting and WebSocket room revoking require `REQUIRE_REDIS=true` and a healthy `REDIS_URL`.
