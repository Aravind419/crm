# SupportOS Enterprise Security Requirements & Specifications

## 1. Multi-Tenant Isolation & Authorization

1. **Mandatory Tenant Verification**:
   - Every API endpoint that handles organization data MUST enforce the `TenantIsolationGuard`.
   - The user's JWT payload contains verified claims: `userId`, `organizationId`, and `role`.
   - Direct Object Reference (IDOR) attacks are neutralized by filtering every database query by `organizationId`. A request specifying an ID belonging to another tenant automatically returns `404 Not Found`.

2. **Role-Based Access Control (RBAC)**:
   - **`OWNER`**: Full billing, organization deletion, API keys, member management, workspace configuration.
   - **`ADMIN`**: Team creation, inbox settings, automations, knowledge base publishing, agent invite.
   - **`AGENT`**: Read/write conversations, create tickets, add internal notes, manage customer profiles.

3. **Public API Sandboxing**:
   - The customer-facing widget endpoints (`/api/v1/public/*`) operate under a strictly restricted scope.
   - Visitors access only their own conversation stream via a signed visitor session token.
   - Internal notes, agent emails, other customers' data, and organization settings are strictly omitted from public DTOs.

---

## 2. Cryptographic Controls & Session Management

1. **Password Storage**:
   - Passwords must be hashed using `Argon2id` (or `bcrypt` with work factor 12+).
   - Plaintext passwords are never logged, serialized into DTOs, or stored in transient cache.

2. **Session Security**:
   - Authentication tokens are issued as cryptographically signed JWTs using HMAC-SHA256 (or RS256).
   - In web environments, session tokens are delivered via `HttpOnly`, `SameSite=Lax`, `Secure` cookies to eliminate XSS token theft.

3. **Visitor Identity Verification (HMAC)**:
   - When an authenticated customer logs into an enterprise website hosting the SupportOS widget, the backend host can compute:
     `HMAC_SHA256(customer_email, inbox_secret)`
   - The widget provides this signature to `/api/v1/public/auth`. The SupportOS backend validates the signature, preventing visitor impersonation.

---

## 3. Input Validation, XSS & Injection Defenses

1. **Strict Type-Safe Validation**:
   - All inbound JSON payloads are validated using NestJS `ValidationPipe` with `class-validator` and `class-transformer` (`whitelist: true`, `forbidNonWhitelisted: true`).
   - Unknown properties are stripped automatically.

2. **SQL Injection Defense**:
   - All database interaction is routed through Prisma ORM using parameterized queries. Raw string interpolation in queries is strictly prohibited.

3. **Cross-Site Scripting (XSS)**:
   - User-generated conversation messages and knowledge base markdown are sanitized using DOMPurify before rendering in the browser.
   - Standard Content Security Policy (CSP) headers are enforced on public endpoints.

---

## 4. File Upload & Attachment Security

1. **Pre-signed Object Storage URLs**:
   - Files are never streamed directly through the backend server memory.
   - Clients request an upload ticket via `/api/v1/attachments/presign`. The server validates the MIME type and file size, then issues a short-lived S3 pre-signed upload URL.

2. **Storage Key Isolation**:
   - S3 keys are prefixed by organization ID and a cryptographically random UUID:
     `attachments/{organizationId}/{year}/{month}/{randomUUID}.{ext}`
   - Direct public access to the S3 bucket is disabled; downloads require short-lived signed URLs generated only after authorization checks.

3. **File Restrictions**:
   - Allowed MIME types: images (`image/png`, `image/jpeg`, `image/webp`, `image/gif`), documents (`application/pdf`, `text/plain`, `text/csv`, `application/zip`).
   - Executable extensions (`.exe`, `.sh`, `.bat`, `.js`, `.html`, `.svg` with script injections) are rejected.
   - Maximum file size: 15 MB per attachment.

---

## 5. Rate Limiting & DoS Protection

1. **API Rate Limiting**:
   - Enforce rate limiting via `@nestjs/throttler` backed by Redis storage.
   - Public Widget Endpoints: Max 60 requests per minute per IP.
   - Authentication Endpoints (`/login`, `/signup`): Max 5 attempts per minute per IP to mitigate credential stuffing.
   - Authenticated Agent Endpoints: Max 300 requests per minute per user.

---

## 6. Audit Trail & Compliance Preparation

1. **Immutable Audit Events**:
   - Critical administrative actions (Agent Invited, Role Changed, Automation Created, Ticket Deleted, Data Exported) generate an immutable `AuditEvent` record with:
     - `organizationId`, `userId`, `action`, `entityType`, `entityId`, `metadata`, `ipAddress`, `timestamp`.
2. **Data Retention & Right to be Forgotten (GDPR / DPDP India)**:
   - Automated tenant data export API (`/api/v1/organizations/export`) outputting full customer and conversation JSON.
   - Cascade deletion API cleanly purging all customer or tenant data upon verified administrative request.
