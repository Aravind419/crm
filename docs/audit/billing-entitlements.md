# SupportOS — Billing & Entitlements Security Specification

## Architecture Overview

SupportOS enforces multi-tier subscription quotas and billing security to prevent unauthorized feature activation, seat overages, and plan tampering.

---

## 1. Subscription Tiers & Feature Matrix

The server-side `EntitlementService` (`apps/api/src/services/entitlement.service.ts`) defines the authoritative quota boundaries for each plan:

| Tier | Agent Seats | Inboxes | Workspaces | Advanced Analytics | Automation Rules | Custom Branding |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **FREE** | 2 | 1 | 1 | No | No | No |
| **TEAM** | 10 | 5 | 2 | Yes | Yes | No |
| **GROWTH** | 25 | 10 | 5 | Yes | Yes | Yes |
| **BUSINESS** | 100 | 50 | 20 | Yes | Yes | Yes |
| **ENTERPRISE**| Unlimited | Unlimited | Unlimited | Yes | Yes | Yes |

---

## 2. Anti-Tampering Defenses

### Direct Plan Mutation Blocking (`PATCH /api/v1/organizations/current`)
Tenants cannot alter their subscription tier via administrative API calls. In `PATCH /current`:

```typescript
if (plan !== undefined) {
  res.status(403).json({
    error: 'Forbidden',
    message: 'Direct subscription plan tampering prohibited. Subscription plans must be modified through verified billing checkouts or signed billing webhooks.',
  });
  return;
}
```

Any attempt to inject `{ plan: 'ENTERPRISE' }` or similar values into organization profile updates is blocked with `403 Forbidden`.

---

## 3. Quota Enforcement

### Agent Seat Limits (`POST /api/v1/users/invite`)
Before adding an agent, `EntitlementService.canAddAgent(organizationId)` queries the database for the active user count (`ACTIVE` and `INVITED`). If the quota has been met:
```json
{
  "error": "Forbidden",
  "message": "Agent limit reached. Your TEAM plan allows up to 10 agents. Upgrade your subscription to add more team members."
}
```

### Inbox Channel Limits (`POST /api/v1/inboxes`)
Before creating an inbox channel, `EntitlementService.canAddInbox(organizationId)` asserts that the current count is beneath `limits.maxInboxes`.

---

## 4. Cryptographic Billing Webhook Verification

External payment gateways (Stripe, Razorpay, LemonSqueezy) update subscription status via `POST /api/v1/organizations/billing/webhook`.

To ensure webhooks cannot be forged or replayed:
1. **HMAC-SHA256 Signature**: The gateway passes a signature header `x-billing-signature`.
2. **Timing-Safe Comparison**:
   ```typescript
   const expectedSignature = crypto
     .createHmac('sha256', config.billingWebhookSecret)
     .update(payload)
     .digest('hex');

   const sigBuffer = Buffer.from(signature);
   const expectedBuffer = Buffer.from(expectedSignature);

   if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
     return res.status(401).json({ error: 'Unauthorized', message: 'Invalid billing webhook signature' });
   }
   ```
3. **Audit Trail**: Every legitimate plan change is logged to the `AuditEvent` table with `action: PLAN_UPGRADED_VIA_BILLING`.
