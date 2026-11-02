# SupportOS Security Audit & Vulnerability Assessment

## 1. Vulnerability Findings & Penetration Test Results

### SEC-01: Unauthorized Socket.IO Conversation Eavesdropping
- **Severity**: Critical
- **Classification**: Confirmed Vulnerability (Resolved)
- **Affected File**: `apps/api/src/services/socket.service.ts` (Lines 67–71)
- **Evidence**:
  ```typescript
  // VULNERABLE CODE (Pre-remediation):
  socket.on('join:conversation', (conversationId: string) => {
    socket.join(`conv:${conversationId}`);
  });
  ```
- **Reproduction**:
  1. An attacker establishes a WebSocket connection.
  2. Emits `join:conversation` with a target conversation ID from another tenant.
  3. Receives live message broadcasts intended for other customers or staff.
- **Remediation**:
  Updated handler validates that:
  - If agent: `prisma.conversation` exists matching both `conversationId` and `socket.data.organizationId`.
  - If visitor: `socket.data.conversationId` equals `conversationId`.
  - Unauthorized requests are rejected with `error:unauthorized`.
- **Test Required**: Re-run socket integration tests and verify room join rejection. (PASSED)

---

### SEC-02: Public Widget Ingestion IDOR & Conversation Hijacking
- **Severity**: Critical
- **Classification**: Confirmed Vulnerability (Resolved)
- **Affected File**: `apps/api/src/routes/public.routes.ts` (Lines 173–240)
- **Evidence**:
  Pre-remediation, `GET /api/v1/public/conversations/:id` and `POST /api/v1/public/conversations/:id/messages` accepted requests without checking the caller's visitor session token.
- **Reproduction**:
  Querying `GET /api/v1/public/conversations/:id` without `x-visitor-token` returned the customer's message history.
- **Remediation**:
  Added mandatory `x-visitor-token` extraction and validation against `customer.customAttributes.visitorToken`. Unauthorized requests return `403 Forbidden`.
- **Test Required**: Verified in `api.test.ts` (Assertion: `unauthFetch.status === 403`). (PASSED)

---

### SEC-03: Insecure Static-Salt Password Hashing
- **Severity**: High
- **Classification**: Confirmed Vulnerability (Resolved)
- **Affected File**: `apps/api/src/routes/auth.routes.ts` & `prisma/seed.ts`
- **Evidence**:
  ```typescript
  // VULNERABLE CODE:
  function hashPassword(password: string): string {
    return crypto.createHash('sha256').update(password + 'supportos_salt_2026').digest('hex');
  }
  ```
- **Risk**: Hardcoded salt and single-round SHA-256 is vulnerable to GPU-accelerated dictionary attacks and rainbow tables.
- **Remediation**: Migrated to `bcryptjs` with salt work factor 10.
- **Test Required**: Login authentication with bcrypt hashed credentials. (PASSED)

---

### SEC-04: Permissive Cross-Origin Resource Sharing (CORS)
- **Severity**: Medium
- **Classification**: Confirmed Defect (Resolved)
- **Affected File**: `apps/api/src/server.ts`
- **Remediation**: Dynamic CORS middleware restricting origins on staff endpoints.
- **Test Required**: Verified OPTIONS and GET requests with Origin headers. (PASSED)
