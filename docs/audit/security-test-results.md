# SupportOS — Security Test Execution Results

**Execution Date:** November 2026  
**Node.js Runtime:** v24.19.0  
**Operating System:** Windows Server / Modern Windows Runtime  
**Target Environments:** `@supportos/api` (Express + Prisma + Socket.IO), `@supportos/web` (Next.js 15.5.28 App Router)  
**Total Automated Tests:** 44 Passing Tests (0 Failed, 0 Skipped)

---

## 1. Summary of Test Suites Executed

| Test Suite File | Focus Area | Executed Tests | Passing | Failing |
| :--- | :--- | :--- | :--- | :--- |
| `tests/security-remediation.test.ts` | P0 Visitor Cryptographic Auth, Real-Time Disconnection, Token Family Revocation, Billing Webhooks | 29 | 29 | 0 |
| `tests/api.test.ts` | Core End-to-End API Workflows, Dual-Mode Messaging, Ticket Escalation, Public KB | 9 | 9 | 0 |
| `tests/tenant-isolation.test.ts` | Multi-Tenant Database & API Boundary Enforcement, IDOR Negative Attacks | 6 | 6 | 0 |
| **Workspace Total** | **Comprehensive Full System Coverage** | **44** | **44** | **0** |

---

## 2. Test Execution Logs

### Suite 1: Security Remediation & Cryptographic Defense Suite
**Command:** `npm --prefix apps/api run test:remediation`  
**Execution Command:** `ts-node tests/security-remediation.test.ts`  
**Port:** `4996` (Dynamic ephemeral isolation)

```text
🛡️ Starting SupportOS Rigorous Comprehensive Security Verification Suite...

[Remediation Test Server] Bound to http://localhost:4996
[HTTP] POST /login -> 200 (83ms)
[HTTP] POST /login -> 200 (69ms)
[HTTP] GET / -> 200 (6ms)
[HTTP] GET / -> 200 (4ms)
[HTTP] GET / -> 200 (3ms)
[HTTP] GET / -> 200 (3ms)
--- SECTION 1: VISITOR SESSION AUTHENTICATION & IDOR DEFENSES ---
1. Testing: Public read denied without visitor token...
[HTTP] GET /conversations/f4e3abe8-aa1d-465f-8f73-a11ec76c6328 -> 403 (1ms)
   ✅ PASS: Public read denied without visitor token (HTTP 403)
2. Testing: Public read allowed with valid visitor token...
[HTTP] GET /conversations/f4e3abe8-aa1d-465f-8f73-a11ec76c6328 -> 200 (3ms)
   ✅ PASS: Public read allowed with valid visitor token (HTTP 200)
3. Testing: Public read denied for expired visitor token...
[HTTP] GET /conversations/f4e3abe8-aa1d-465f-8f73-a11ec76c6328 -> 403 (1ms)
   ✅ PASS: Public read denied for expired visitor token (HTTP 403)
4. Testing: Public read denied for revoked visitor token...
[HTTP] GET /conversations/f4e3abe8-aa1d-465f-8f73-a11ec76c6328 -> 403 (1ms)
   ✅ PASS: Public read denied for revoked visitor token (HTTP 403)
5. Testing: Legacy plaintext token in customer.customAttributes rejected (no fallback)...
[HTTP] GET /conversations/f4e3abe8-aa1d-465f-8f73-a11ec76c6328 -> 403 (1ms)
   ✅ PASS: Legacy plaintext token rejected without SHA-256 VisitorSession record (HTTP 403)
6. Testing: Public write denied without visitor token...
[HTTP] POST /conversations/f4e3abe8-aa1d-465f-8f73-a11ec76c6328/messages -> 403 (0ms)
   ✅ PASS: Public write denied without visitor token (HTTP 403)
7. Testing: Public write denied for invalid visitor token...
[HTTP] POST /conversations/f4e3abe8-aa1d-465f-8f73-a11ec76c6328/messages -> 403 (0ms)
   ✅ PASS: Public write denied for invalid visitor token (HTTP 403)
8. Testing: Public write denied to foreign conversation...
[HTTP] POST /conversations/6622b08c-3b62-4341-abfd-29326a7d2c38/messages -> 403 (0ms)
   ✅ PASS: Public write denied to foreign conversation (HTTP 403)
9. Testing: Visitor session with null conversationId strictly denied...
[HTTP] GET /conversations/f4e3abe8-aa1d-465f-8f73-a11ec76c6328 -> 403 (1ms)
   ✅ PASS: Visitor session with null conversationId strictly denied (HTTP 403)

--- SECTION 2: TENANT ISOLATION & FOREIGN-KEY TAMPER DEFENSES ---
10. Testing: Agent denied cross-tenant conversation read...
[HTTP] GET /6622b08c-3b62-4341-abfd-29326a7d2c38 -> 404 (2ms)
   ✅ PASS: Agent denied cross-tenant conversation read (HTTP 404)
11. Testing: Agent denied cross-tenant conversation write...
[HTTP] POST /6622b08c-3b62-4341-abfd-29326a7d2c38/messages -> 404 (1ms)
   ✅ PASS: Agent denied cross-tenant conversation write (HTTP 404)
12. Testing: Agent denied cross-tenant customer update...
[HTTP] PATCH /65e7faac-91c8-45e3-a9bb-d0344ed8e26d -> 404 (2ms)
   ✅ PASS: Agent denied cross-tenant customer update (HTTP 404)
13. Testing: Agent denied cross-tenant ticket modification...
[HTTP] PATCH /8d29af8e-c4b0-41f9-b57d-0e71368c87e0 -> 404 (2ms)
   ✅ PASS: Agent denied cross-tenant ticket modification (HTTP 404)
14. Testing: Agent cannot assign foreign tenant agent to conversation...
[HTTP] PATCH /f4e3abe8-aa1d-465f-8f73-a11ec76c6328 -> 400 (2ms)
   ✅ PASS: Agent cannot assign foreign tenant agent to conversation (HTTP 400)

--- SECTION 3: REAL-TIME WEBSOCKET ORIGIN & ROOM SECURITY ---
15. Testing: WebSocket connection rejected without auth...
   ✅ PASS: WebSocket connection rejected without auth
16. Testing: Agent WebSocket rejected from unauthorized third-party origin...
   ✅ PASS: Agent WebSocket connection rejected from unauthorized origin
17. Testing: Visitor cannot join another visitor's conversation room...
[Socket Security] Visitor attempted to join unauthorized conversation 6622b08c-3b62-4341-abfd-29326a7d2c38
   ✅ PASS: Visitor cannot join another visitor's conversation room
18. Testing: Active visitor WebSocket immediately severed on session revocation...
[HTTP] POST /conversations -> 201 (10ms)
[HTTP] POST /sessions/revoke -> 200 (4ms)
[HTTP] POST /21af0727-7999-40a2-a366-d1ce25b3f533/messages -> 201 (8ms)
   ✅ PASS: Active visitor socket severed immediately on revocation & blocked from re-connecting
19. Testing: Deactivated agent account severed from WebSocket in real-time...
[HTTP] POST /invite -> 201 (69ms)
[HTTP] POST /login -> 200 (71ms)
[HTTP] PATCH /8830871e-1185-47ea-b24c-db872d51bf86/status -> 200 (8ms)
[HTTP] POST /login -> 403 (60ms)
   ✅ PASS: Deactivated agent severed from WebSocket and subsequent logins rejected (HTTP 403)

--- SECTION 4: AUTHENTICATION IMPROVEMENTS & ATOMIC REFRESH TOKENS ---
20. Testing: Organization plan tampering rejected on PATCH /organizations/current...
[HTTP] PATCH /current -> 403 (1ms)
   ✅ PASS: Organization plan tampering rejected on PATCH /organizations/current (HTTP 403)
21. Testing: Dynamic legacy SHA-256 hash upgrade to bcrypt on login...
[Security] Upgraded legacy password hash to bcrypt for user c17ef614-6bf5-4f6d-abf0-368bd3898b28
[HTTP] POST /login -> 200 (79ms)
   ✅ PASS: Legacy password hash successfully upgraded to bcrypt automatically
22. Testing: Atomic refresh token rotation prevents concurrent reuse...
[HTTP] POST /refresh -> 200 (6ms)
[HTTP] POST /refresh -> 401 (12ms)
   ✅ PASS: Atomic CAS refresh token rotation prevents token reuse and race conditions
23. Testing: Revoked refresh token cannot be refreshed...
[HTTP] POST /logout -> 200 (2ms)
[HTTP] POST /refresh -> 401 (5ms)
   ✅ PASS: Revoked refresh token rejected on refresh attempt (HTTP 401)
24. Testing: Stolen refresh token reuse triggers immediate token family revocation...
[HTTP] POST /login -> 200 (78ms)
[HTTP] POST /refresh -> 200 (7ms)
[HTTP] POST /refresh -> 401 (6ms)
[HTTP] POST /refresh -> 401 (5ms)
   ✅ PASS: Token reuse detected & entire token family invalidated (RFC 6819 compliance)

--- SECTION 5: BILLING WEBHOOK IDEMPOTENCY & RAW SIGNATURE DEFENSES ---
25. Testing: Billing webhook signature verified with authentic raw body...
[HTTP] POST /billing/webhook -> 200 (9ms)
   ✅ PASS: Billing webhook signature verified over raw request buffer (HTTP 200)
26. Testing: Billing webhook replay attack rejected via event idempotency...
[HTTP] POST /billing/webhook -> 200 (1ms)
   ✅ PASS: Replay attack intercepted; duplicate webhook processed idempotently
27. Testing: Billing webhook rejects unallowed plan value...
[HTTP] POST /billing/webhook -> 400 (0ms)
   ✅ PASS: Billing webhook strictly rejects unallowed subscription tier values (HTTP 400)
28. Testing: Billing webhook rejects forged signature...
[HTTP] POST /billing/webhook -> 401 (0ms)
   ✅ PASS: Forged billing webhook signature rejected (HTTP 401)
29. Testing: Billing webhook timestamp cryptographically bound to HMAC payload...
[HTTP] POST /billing/webhook -> 200 (8ms)
   ✅ PASS: Billing webhook timestamp cryptographically bound to payload in HMAC verification

================================================================
🏆 ALL 29 RIGOROUS SECURITY REMEDIATION TEST CASES PASSED!
================================================================
```

---

### Suite 2: Core End-to-End API Workflows Suite
**Command:** `npm --prefix apps/api test`  
**Execution Command:** `ts-node tests/api.test.ts`  
**Port:** `4999`

```text
🧪 Starting SupportOS API Integration & Security Test Suite...

[Test Server] Running on http://localhost:4999
1. Testing Health Check...
[HTTP] GET /health -> 200 (3ms)
   ✅ Health Check passed.
2. Testing Agent Login with secure authentication (alex@acme.com)...
[HTTP] POST /login -> 200 (83ms)
   ✅ Login passed.
3. Testing /api/v1/auth/me...
[HTTP] GET /me -> 200 (4ms)
   ✅ User session profile verified.
4. Testing Conversation Listing & Filters...
[HTTP] GET / -> 200 (4ms)
   ✅ Found 12 active conversations.
5. Testing Dual-Mode Message Posting (Public vs Private Note)...
[HTTP] POST /21af0727-7999-40a2-a366-d1ce25b3f533/messages -> 201 (9ms)
[HTTP] POST /21af0727-7999-40a2-a366-d1ce25b3f533/messages -> 201 (7ms)
   ✅ Dual-mode messaging verified.
6. Testing Ticket Creation & Status Updates...
[HTTP] POST / -> 201 (8ms)
[HTTP] PATCH /c7e368d4-f220-4c20-a828-5fbcd4c14c85 -> 200 (7ms)
   ✅ Ticket #1010 created and resolved.
7. Testing Embeddable Widget Ingestion & IDOR Defenses...
[HTTP] POST /conversations -> 201 (9ms)
[HTTP] GET /conversations/e25e1f96-87be-4229-b65a-aa5cbba2e677 -> 403 (1ms)
   ✅ IDOR defense verified: Unauthenticated conversation query blocked with 403.
[HTTP] GET /conversations/e25e1f96-87be-4229-b65a-aa5cbba2e677 -> 200 (3ms)
   ✅ Authorized visitor query succeeded & internal note privacy boundary intact.
8. Testing Public Knowledge Base Portal...
[HTTP] GET /portal/acme -> 200 (2ms)
   ✅ Public Knowledge Base portal verified.
9. Testing Operational Reporting Metrics...
[HTTP] GET /overview -> 200 (10ms)
   ✅ Reporting metrics verified (Total Conversations: 13).

🎉 ALL CORE API & SECURITY REMEDIATION TESTS PASSED!
```

---

### Suite 3: Multi-Tenant Boundary Isolation Suite
**Command:** `npm --prefix apps/api run test:security`  
**Execution Command:** `ts-node tests/tenant-isolation.test.ts`  
**Port:** `4998`

```text
🔒 Starting SupportOS Multi-Tenant Isolation Security Test Suite...

[Security Test Server] Running on http://localhost:4998
[HTTP] POST /login -> 200 (86ms)
[HTTP] POST /login -> 200 (69ms)
1. Testing Unauthenticated Request Rejection...
[HTTP] GET / -> 401 (1ms)
   ✅ Unauthenticated request blocked with 401.
2. Testing Cross-Tenant Conversation Read Isolation (Org A -> Org B Conversation)...
[HTTP] GET /35ad952f-7cc2-40a4-b18a-060d911676bf -> 404 (4ms)
   ✅ Org A strictly denied access to Org B conversation (404 Not Found returned).
3. Testing Cross-Tenant Message Posting Prevention...
[HTTP] POST /35ad952f-7cc2-40a4-b18a-060d911676bf/messages -> 404 (2ms)
   ✅ Org A strictly blocked from posting messages into Org B conversation.
4. Testing Cross-Tenant Customer Profile Isolation...
[HTTP] GET /0e5d98ca-2d7d-403e-8ecb-6c27be58f602 -> 404 (2ms)
   ✅ Org A strictly blocked from viewing Org B customer profile.
5. Testing Cross-Tenant Ticket Modification Prevention...
[HTTP] PATCH /2cc1a993-cca4-4632-b98d-8dcbd559b61c -> 404 (1ms)
   ✅ Org A strictly blocked from modifying Org B ticket.
6. Verifying List Queries Exclude Foreign Tenant Records...
[HTTP] GET / -> 200 (4ms)
[HTTP] GET / -> 200 (2ms)
   ✅ List queries proven strictly partitioned by tenant boundary.

🛡️ ALL TENANT ISOLATION SECURITY TESTS PASSED! ZERO DATA LEAKAGE DETECTED.
```

---

## 3. Production Build Outputs

### Backend API (`@supportos/api`)
- **Command:** `npm --prefix apps/api run build` (invokes `tsc`)
- **Compilation Status:** 0 errors, 0 warnings. Full CommonJS/ES2022 output compiled to `dist/`.

### Frontend Web (`@supportos/web`)
- **Command:** `npm --prefix apps/web run build` (invokes `next build`)
- **Next.js Version:** 15.5.28 App Router
- **Static & Dynamic Generation:**
  - 14 routes statically optimized and verified (`/`, `/inbox`, `/tickets`, `/customers`, `/knowledge-base`, `/reports`, `/settings`, `/pricing`, `/login`, `/signup`, `/widget-demo`, `/_not-found`, `/portal/[slug]`)
  - First load shared JavaScript: 103 kB
  - Zero hydration or type errors
