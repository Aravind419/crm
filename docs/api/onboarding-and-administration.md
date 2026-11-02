# SupportOS API — Phase 1: Onboarding & Administration Specification

This document details the public and protected API contracts introduced in **Phase 1: Company Onboarding & Administration**.

All endpoints enforce tenant isolation, role-based authorization, rate limiting, and zero-trust parameter validation.

---

## 1. Organization & Onboarding Endpoints

### `GET /api/v1/organizations/current`
Retrieves comprehensive organization profile, operational schedule, custom branding, and active subscription limits.

- **Authentication**: `Bearer <JWT>`
- **Authorization**: All authenticated members (Owner, Admin, Agent).
- **Response (200 OK)**:
  ```json
  {
    "organization": {
      "id": "uuid-v4",
      "name": "Acme Technologies",
      "slug": "acme",
      "plan": "GROWTH",
      "status": "ACTIVE",
      "logoUrl": "https://cdn.acme.com/logo.png",
      "brandColor": "#2563EB",
      "timezone": "America/New_York",
      "locale": "en-US",
      "businessHours": "{\"timezone\":\"America/New_York\",\"schedule\":{...}}",
      "allowedDomains": "[\"acme.com\",\"app.acme.com\"]",
      "onboardingCompleted": true,
      "onboardingStep": 4,
      "createdAt": "2026-11-02T10:00:00.000Z",
      "workspaces": [...],
      "inboxes": [...],
      "_count": { "users": 5, "teams": 2 }
    },
    "subscription": {
      "plan": "GROWTH",
      "status": "ACTIVE",
      "limits": {
        "maxAgents": 25,
        "maxInboxes": 10,
        "maxWorkspaces": 5,
        "features": {
          "advancedReporting": true,
          "automationRules": true,
          "customBranding": true
        }
      }
    }
  }
  ```

---

### `PATCH /api/v1/organizations/current`
Updates company branding, operating hours, and domain boundaries.

- **Authentication**: `Bearer <JWT>`
- **Authorization**: `OWNER` or `ADMIN`.
- **Anti-Tampering**: Passing `plan` or `status` directly is rejected with `HTTP 403 Forbidden`. Subscription modifications require verified Stripe checkouts or signed billing webhooks.
- **Request Body**:
  ```json
  {
    "name": "Acme Global Technologies",
    "logoUrl": "https://cdn.acme.com/brand/mark.svg",
    "brandColor": "#3B82F6",
    "timezone": "UTC",
    "locale": "en",
    "businessHours": { ... },
    "allowedDomains": ["acme.com", "app.acme.com"]
  }
  ```
- **Response (200 OK)**: Returns updated organization profile.

---

### `POST /api/v1/organizations/onboarding`
Executes multi-step setup wizard or marks tenant onboarding complete.

- **Authentication**: `Bearer <JWT>`
- **Authorization**: `OWNER` or `ADMIN`.
- **Validation Rules**:
  - `step`: Must be an integer between 1 and 5.
  - `companyName`: Non-empty string (1 to 100 characters).
  - `brandColor` / `widgetColor`: Strict 6-character hex format (`^#[0-9A-Fa-f]{6}$`).
  - `timezone`: Valid IANA timezone identifier validated via V8 `Intl.DateTimeFormat`.
  - `locale`: Valid BCP 47 language/locale tag.
  - `logoUrl`: Valid `http:` or `https:` URL with valid hostname.
  - `allowedDomains`: Domain list or comma-separated origins. Wildcard `*` strictly rejected.
  - `businessHours`: Day names (`monday`..`sunday`), 24-hr `HH:MM` format, and `start < end` consistency.
  - `completed: true`: Mandatory readiness check: company name, brand color, timezone, locale, business hours schedule, workspace, and inbox greeting must be satisfied before completion is granted.
- **Request Body**:
  ```json
  {
    "step": 4,
    "completed": true,
    "companyName": "Acme Corp",
    "logoUrl": "https://cdn.acme.com/logo.png",
    "brandColor": "#2563EB",
    "timezone": "Asia/Kolkata",
    "locale": "en-IN",
    "businessHours": { ... },
    "allowedDomains": ["acme.com"],
    "workspaceName": "Tier 1 Support HQ",
    "inboxGreeting": "Hello! Welcome to SupportOS.",
    "widgetColor": "#2563EB"
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "message": "Onboarding successfully completed",
    "organization": { ... }
  }
  ```

---

### `GET /api/v1/organizations/widget-snippet`
Generates production-ready script embed tags for customer website integration using the verified public application URL (`config.appUrl`).

- **Authentication**: `Bearer <JWT>`
- **Authorization**: All authenticated organization members.
- **Response (200 OK)**:
  ```json
  {
    "publicAppUrl": "https://app.supportos.dev",
    "snippets": [
      {
        "inboxId": "uuid-v4",
        "inboxName": "Website Live Chat",
        "inboxKey": "inbox_acme_a9b1c2d3",
        "widgetColor": "#2563EB",
        "greeting": "Hi there! How can we help?",
        "allowedOrigins": "https://acme.com",
        "snippet": "<script src=\"https://app.supportos.dev/widget.js\" data-inbox-key=\"inbox_acme_a9b1c2d3\" async></script>"
      }
    ]
  }
  ```

---

## 2. Secure Agent Invitation & Authentication

### `POST /api/v1/users/invite`
Issues a single-use cryptographically secure invitation.
- **Security Guarantees**:
  - Raw token is never stored in database (stored as SHA-256 hash).
  - Account created with status `INVITED` and unmatchable random password hash.
  - No hardcoded default passwords.
  - Role escalation strictly prevented: Admins cannot invite or assign Owners.
  - Enforces subscription seat limits (`EntitlementService.canAddAgent`).
  - Sends email via verified SMTP/Resend or explicitly reports `BLOCKED_MISSING_CREDENTIALS` (never fakes success).
- **Authentication**: `Bearer <JWT>`
- **Authorization**: `OWNER` or `ADMIN`.
- **Request Body**:
  ```json
  {
    "email": "agent@acme.com",
    "firstName": "Jane",
    "lastName": "Doe",
    "role": "AGENT",
    "teamIds": ["team-uuid-v4"]
  }
  ```
- **Response (201 Created)**:
  ```json
  {
    "message": "Agent invitation created successfully",
    "user": {
      "id": "uuid-v4",
      "email": "agent@acme.com",
      "role": "AGENT",
      "status": "INVITED",
      "invitationExpiresAt": "2026-11-09T10:00:00.000Z"
    },
    "invitationUrl": "https://app.supportos.dev/invite/64-char-raw-entropy-hex",
    "emailDelivery": {
      "provider": "smtp",
      "status": "SENT" // or "BLOCKED_MISSING_CREDENTIALS"
    }
  }
  ```

---

### `GET /api/v1/auth/invitations/:token`
Public pre-flight inspection for invitation acceptance page. Resolves invitation metadata via SHA-256 hash lookup.

- **Authentication**: Public
- **Response (200 OK)**:
  ```json
  {
    "valid": true,
    "email": "agent@acme.com",
    "role": "AGENT",
    "organizationName": "Acme Technologies",
    "inviterName": "Administrator",
    "expiresAt": "2026-11-09T10:00:00.000Z"
  }
  ```
- **Error Responses**:
  - `404 Not Found`: Invalid or previously consumed token.
  - `410 Gone`: Invitation expired.

---

### `POST /api/v1/auth/invitations/accept`
Public endpoint allowing invited agent to define their own password and activate their account.
- **Single-Use Replay Defense**: Immediately zeroes `invitationTokenHash` and `invitationExpiresAt` in an atomic database transaction. Subsequent attempts return `HTTP 404/400`.
- **Authentication**: Public (Rate-limited: 5 requests/min per IP)
- **Request Body**:
  ```json
  {
    "token": "64-char-raw-entropy-hex",
    "firstName": "Jane",
    "lastName": "Doe",
    "password": "SecurePassword123!"
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "message": "Invitation accepted successfully. Welcome to SupportOS!",
    "token": "jwt-access-token",
    "refreshToken": "refresh-token-uuid",
    "user": {
      "id": "uuid-v4",
      "email": "agent@acme.com",
      "firstName": "Jane",
      "lastName": "Doe",
      "role": "AGENT",
      "status": "ACTIVE"
    },
    "organization": { ... }
  }
  ```

---

### `POST /api/v1/users/:id/invitation/resend`
Rotates invitation token hash, generates a new 7-day expiration, and re-triggers email delivery.

- **Authentication**: `Bearer <JWT>`
- **Authorization**: `OWNER` or `ADMIN`.
- **Response (200 OK)**: Returns updated `invitationUrl` and `emailDelivery` status.

---

### `DELETE /api/v1/users/:id/invitation`
Revokes an outstanding invitation.
- **Lifecycle Guarantee**: Retains the user record with status `DEACTIVATED`, clears `invitationTokenHash` and `invitationExpiresAt`, and preserves an audit trail event (`INVITATION_REVOKED`).
- **Access Defense**: Revoked tokens cannot be inspected or accepted (`HTTP 404`). Resend on a revoked user is blocked (`HTTP 400`). To reinvite, use the explicit re-invitation workflow.
- **Authentication**: `Bearer <JWT>`
- **Authorization**: `OWNER` or `ADMIN`.
- **Response (200 OK)**:
  ```json
  {
    "message": "Invitation revoked successfully",
    "status": "DEACTIVATED"
  }
  ```

---

### `POST /api/v1/users/:id/invitation/reinvite`
Explicit re-invitation workflow for a previously revoked or deactivated user.
- **Concurrency & Quota Control**: Locks the organization row, validates available subscription seats, sets status `INVITED`, generates a new 256-bit cryptographically secure single-use token and 7-day expiration, and dispatches the invitation email.
- **Authentication**: `Bearer <JWT>`
- **Authorization**: `OWNER` or `ADMIN`.
- **Response (200 OK)**:
  ```json
  {
    "message": "Agent re-invited successfully",
    "user": {
      "id": "uuid-v4",
      "email": "agent@acme.com",
      "role": "AGENT",
      "status": "INVITED",
      "invitationExpiresAt": "2026-11-09T10:00:00.000Z"
    },
    "invitationUrl": "https://app.supportos.dev/invite/64-char-raw-entropy-hex",
    "emailDelivery": {
      "acceptedByProvider": true,
      "status": "SENT",
      "provider": "SMTP",
      "deliveryNote": "Accepted by SMTP transport for queuing/dispatch. Inbox delivery is subject to recipient mail server acceptance."
    }
  }
  ```

---

## 3. Team Management Endpoints

### `GET /api/v1/teams`
Lists all teams in tenant, including member lists, designated team lead, and real-time workload counts.

- **Authentication**: `Bearer <JWT>`
- **Authorization**: All authenticated members.
- **Response (200 OK)**:
  ```json
  {
    "teams": [
      {
        "id": "uuid-v4",
        "name": "Billing Escalations",
        "description": "Subscription and payment inquiries",
        "leadId": "user-uuid-v4",
        "lead": {
          "id": "user-uuid-v4",
          "firstName": "Alex",
          "lastName": "Chen",
          "email": "alex@acme.com"
        },
        "members": [ ... ],
        "metrics": {
          "conversations": 14,
          "tickets": 6
        }
      }
    ]
  }
  ```

---

### `POST /api/v1/teams`
Creates a team with optional lead and member assignments. Validates all foreign IDs belong to the calling organization.

- **Authentication**: `Bearer <JWT>`
- **Authorization**: `OWNER` or `ADMIN`.
- **Request Body**:
  ```json
  {
    "name": "Technical Support",
    "description": "L2 technical escalations",
    "leadId": "user-uuid-v4",
    "memberIds": ["user-uuid-1", "user-uuid-2"]
  }
  ```
- **Response (201 Created)**: Returns created team record with lead and members.

---

### `PATCH /api/v1/teams/:id`
Updates team details or reassigns team lead.

- **Authentication**: `Bearer <JWT>`
- **Authorization**: `OWNER` or `ADMIN`.
- **Request Body**:
  ```json
  {
    "name": "Core Technical Support",
    "leadId": "new-lead-uuid"
  }
  ```
- **Response (200 OK)**: Returns updated team.

---

### `DELETE /api/v1/teams/:id`
Safely unlinks assigned conversations and tickets, removes member relationships, and deletes the team.

- **Authentication**: `Bearer <JWT>`
- **Authorization**: `OWNER` or `ADMIN`.
- **Response (200 OK)**: `{ "message": "Team deleted successfully" }`.

---

### `POST /api/v1/teams/:id/members`
Assigns an agent to a team.

- **Authentication**: `Bearer <JWT>`
- **Authorization**: `OWNER` or `ADMIN`.
- **Request Body**: `{ "userId": "user-uuid-v4" }`
- **Response (200 OK)**: `{ "message": "Member added to team" }`.

---

### `DELETE /api/v1/teams/:id/members/:userId`
Removes an agent from a team.

- **Authentication**: `Bearer <JWT>`
- **Authorization**: `OWNER` or `ADMIN`.
- **Response (200 OK)**: `{ "message": "Member removed from team" }`.

---

## 4. Agent Role & Lifecycle Management

### `PATCH /api/v1/users/:id/role`
Updates an agent's organizational role.
- **Security Guarantees**:
  - `ADMIN` cannot grant or modify `OWNER` role.
  - Sole `OWNER` cannot demote self.
- **Authentication**: `Bearer <JWT>`
- **Authorization**: `OWNER` or `ADMIN`.
- **Request Body**: `{ "role": "ADMIN" }` // `AGENT`, `ADMIN`, `OWNER`
- **Response (200 OK)**: Returns updated user record.

---

### `PATCH /api/v1/users/:id/status`
Activates or deactivates an agent account.
- **Security Guarantees**:
  - Deactivating an account immediately severs active WebSocket connections across the distributed cluster.
  - All issued refresh tokens for the user are atomically revoked.
  - Subsequent logins are rejected with `HTTP 403 Forbidden`.
  - Reactivation checks subscription seat limit (`EntitlementService.canAddAgent`).
- **Authentication**: `Bearer <JWT>`
- **Authorization**: `OWNER` or `ADMIN`.
- **Request Body**: `{ "status": "DEACTIVATED" }` // `ACTIVE` or `DEACTIVATED`
- **Response (200 OK)**: Returns updated user record.
