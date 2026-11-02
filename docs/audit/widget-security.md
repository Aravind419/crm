# SupportOS — Embeddable Widget Security Specification

## Architecture Overview

SupportOS includes an embeddable live chat widget (`packages/widget/src/supportos.js` and `apps/web/public/widget.js`) designed to be embedded on customer websites via a lightweight script tag:

```html
<script src="https://support.example.com/widget.js" data-inbox-key="inbox_acme_live_49f82d" async></script>
```

Because this widget operates in public, unauthenticated environments (end-user browsers), robust protections against IDOR (Insecure Direct Object Reference), session hijacking, spam, and cross-origin attacks are mandatory.

---

## 1. Cryptographically Secure Visitor Sessions

### Generation & Token Entropy
- When a visitor initiates a conversation (`POST /api/v1/public/conversations`), the API generates a high-entropy 256-bit token:
  ```typescript
  const safeVisitorToken = `vst_${crypto.randomBytes(32).toString('hex')}`;
  ```
- **Entropy**: 256 bits of CSPRNG randomness, rendering brute-force or enumeration attacks mathematically infeasible.

### Storage & Hash Protection
- The raw token is returned to the client browser and stored in `localStorage` under `supportos_visitor_token`.
- The database stores **only** the SHA-256 hash digest of the token in the `VisitorSession` table:
  ```typescript
  const tokenHash = crypto.createHash('sha256').update(safeVisitorToken).digest('hex');
  ```
- Even in the event of an unauthorized database snapshot read, active visitor tokens cannot be reverse-engineered or replayed.

### Session Expiration & Revocation
- **Expiration**: Visitor sessions have an enforced expiration window (`expiresAt: 30 days`).
- **Revocation**: Sockets and HTTP sessions can be revoked via `POST /api/v1/public/sessions/revoke`. Expired or revoked sessions return `403 Forbidden`.

---

## 2. Public API Guarding & IDOR Elimination

### A. Conversation Fetching (`GET /api/v1/public/conversations/:conversationId`)
- The request must supply the visitor token in the `x-visitor-token` HTTP header.
- The server hashes the header token and validates:
  1. `VisitorSession` exists with matching `tokenHash`.
  2. `session.expiresAt > new Date()`.
  3. `session.revokedAt === null`.
  4. `session.conversationId === req.params.conversationId`.
- If any check fails, access is rejected with `403 Forbidden`.
- **Private Note Stripping**: Message retrieval explicitly queries `{ where: { messageType: 'PUBLIC_REPLY' } }`, guaranteeing staff notes are never returned in public HTTP payloads.

### B. Message Ingestion (`POST /api/v1/public/conversations/:conversationId/messages`)
- Requires valid visitor session bound to the target conversation.
- Content is trimmed and validated.
- Rate limiting enforces a sliding-window ceiling of 120 requests/minute per IP address.

---

## 3. CORS & Cross-Origin Security

- Public widget endpoints (`/api/v1/public/*`) allow cross-origin requests from embedder websites while strictly requiring cryptographic token authorization for conversation access.
- Non-public endpoints (`/api/v1/auth/*`, `/api/v1/conversations/*`, `/api/v1/tickets/*`) enforce a strict origin whitelist (`config.corsOrigins`).

---

## 4. Input Sanitization & Payload Constraints

- Public ingress endpoints enforce a strict `50KB` JSON payload ceiling.
- Oversized payloads, malformed JSON, and prototype pollution patterns are rejected with HTTP 413 / 400.
