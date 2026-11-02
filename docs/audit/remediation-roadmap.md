# SupportOS Remediation Roadmap & Action Plan

## 1. Remediation Status Tracking

### Phase 1: Critical & High Remediations (COMPLETED)
- [x] **Remediate SEC-01 (Critical)**: Enforce strict tenant and session authorization in Socket.IO `join:conversation` handler.
- [x] **Remediate SEC-02 (Critical)**: Enforce visitor session token verification on public widget endpoints to eliminate IDOR risks.
- [x] **Remediate AUTH-01 (High)**: Replace single-round SHA-256 with `bcryptjs` (salt rounds: 10) for all password hashing.
- [x] **Remediate CORS-01 (Medium)**: Restrict CORS origin on private staff API routes to configured environment origins.
- [x] **Remediate OPS-01 (Medium)**: Author `Dockerfile.api`, `Dockerfile.web`, and `docker-compose.yml`.
- [x] **Remediate RATE-01 (Low)**: Add automated IP timestamp pruning to in-memory rate limiter.
- [x] **Re-Run Integration & Security Suites**: Verified 100% test pass rate post-remediation.

---

## 2. Phase 2: Production Hardening Tasks (Next Sprint)

1. **PostgreSQL RLS Migration**:
   - Spin up staging PostgreSQL 16 container.
   - Run `npx prisma migrate dev --name init` using `prisma/schema.postgresql.prisma`.
   - Apply DDL script enabling PostgreSQL Row Level Security policies on `conversations`, `tickets`, `customers`, and `messages`.
   
2. **Authentication Enhancements**:
   - Implement `/api/v1/auth/forgot-password` and `/api/v1/auth/reset-password` with secure single-use time-limited tokens.
   - Implement email verification using Resend or SMTP provider.
   - Provide toggle `NEXT_PUBLIC_ENABLE_EVAL_CREDENTIALS=false` to hide evaluation presets on production login.

3. **Session Cookie Migration**:
   - Migrate web authentication from `localStorage` to `HttpOnly`, `SameSite=Lax`, `Secure` cookies.
   - Implement CSRF token verification middleware on mutating endpoints.

4. **Structured Logging & Error Monitoring**:
   - Replace `console.log` with structured JSON logger (Pino).
   - Integrate Sentry or OpenTelemetry for runtime unhandled exception tracking.
