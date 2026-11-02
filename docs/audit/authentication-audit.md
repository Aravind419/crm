# SupportOS Authentication & Session Security Audit

## 1. Password Storage & Hashing
- **Audit Finding**: In the initial build, passwords were authenticated using a single-round SHA-256 hash with static salt.
- **Remediation**:
  - Migrated to `bcryptjs` with 10 salt rounds in `apps/api/src/routes/auth.routes.ts`.
  - Added backward-compatibility hash verification to support existing seeded accounts.
- **Status**: PASSED.

---

## 2. Token & Session Management
- **Token Mechanism**: JSON Web Token (JWT) signed with HMAC-SHA256 (`jwt.sign`).
- **Token Payload**: Contains `userId`, `organizationId`, `email`, and `role`.
- **Token Expiry**: Configured to `7d` via `JWT_EXPIRES_IN`.
- **Client Storage Audit**:
  - The web application currently stores the JWT token in `localStorage`.
  - *Risk*: `localStorage` is accessible to client-side JavaScript, leaving it vulnerable if an XSS flaw exists.
  - *Recommendation for Enterprise Phase*: Migrate to `HttpOnly`, `SameSite=Lax`, `Secure` cookies with CSRF double-submit tokens.

---

## 3. Evaluation Shortcuts & Test Credentials
- **Finding**: The `/login` page features one-click preset buttons:
  - Alex Chen (`alex@acme.com` - Owner)
  - Vikram Rao (`vikram@acme.com` - Agent)
  - Maya Patel (`maya@starlight.com` - Isolated Org)
- **Assessment**:
  - These are intentionally exposed on the frontend for local development and paired evaluation.
  - *Production Guard*: A build-time or environment flag (`NEXT_PUBLIC_ENABLE_EVAL_CREDENTIALS=true`) must hide these buttons in production environments.

---

## 4. Missing Authentication Features (Roadmap Gaps)
- **Password Reset Flow**: `/forgot-password` and `/reset-password` are not implemented.
- **Email Verification**: Users can log in immediately upon registration without email confirmation.
- **MFA (TOTP)**: Not yet implemented.
