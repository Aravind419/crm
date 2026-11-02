# SupportOS Feature Inventory & Gap Analysis

This feature inventory classifies all identified capabilities across the three benchmark platforms (Intercom, Zendesk, Chatwoot) and specifies the target inclusion for SupportOS (MVP, Phase 2, Future Enterprise).

## 1. Feature Taxonomy & Prioritization

Status Key:
- **MVP (P0)**: Required for immediate functional release.
- **Phase 2 (P1)**: Scheduled for subsequent release post-core stabilization.
- **Future (P2)**: Advanced enterprise or AI-specific extension.

---

### Module A: Multi-Tenant Organization & Workspace Management
| Feature | Competitor Equivalent | Priority | Description |
| :--- | :--- | :--- | :--- |
| Multi-tenant isolation | All | **P0 (MVP)** | Strict data segregation by `organization_id` on all tables with DB indexes. |
| Workspaces | Intercom/Zendesk | **P0 (MVP)** | Workspaces representing brands or operational business units under an organization. |
| Organization profile & branding | All | **P0 (MVP)** | Name, slug, logo URL, default timezone, business hours, and locale settings. |
| Domain verification | Zendesk/Intercom | **P1** | Custom domain DNS verification for support portals and email channels. |
| Multi-brand management | Zendesk | **P2** | Operating multiple disparate customer-facing brands under a single billing account. |

---

### Module B: Authentication & Role-Based Access Control (RBAC)
| Feature | Competitor Equivalent | Priority | Description |
| :--- | :--- | :--- | :--- |
| Email & Password authentication | All | **P0 (MVP)** | Argon2id/bcrypt hashed passwords, secure HTTP-only cookies / JWT session tokens. |
| User registration & onboarding | All | **P0 (MVP)** | Account signup with automated workspace initialization. |
| Agent invitation flow | All | **P0 (MVP)** | Secure email invite token with expiry and role assignment. |
| Role-based access control | All | **P0 (MVP)** | Predefined roles: `Owner`, `Admin`, `Agent`, with granular permission checks. |
| Multi-Factor Authentication (MFA/TOTP) | Zendesk/Intercom | **P1** | RFC 6238 TOTP authenticator app support. |
| Single Sign-On (SAML 2.0 / OIDC) | Zendesk/Intercom | **P2** | Enterprise identity provider integration (Okta, Azure AD, Google Workspace). |

---

### Module C: Shared Inbox & Real-Time Conversations
| Feature | Competitor Equivalent | Priority | Description |
| :--- | :--- | :--- | :--- |
| Unified Inbox | All | **P0 (MVP)** | Live synchronized list of active customer conversations across channels. |
| Real-time messaging stream | Intercom/Chatwoot | **P0 (MVP)** | Sub-second message delivery via WebSocket (Socket.IO). |
| Customer message vs Internal note | All | **P0 (MVP)** | Clear visual distinction between customer replies and private staff notes. |
| Conversation states | All | **P0 (MVP)** | `Open`, `Pending`, `Snoozed`, and `Resolved` states with filter tabs. |
| Agent assignment & Team routing | All | **P0 (MVP)** | Assigning conversations to specific agents or functional teams (e.g. Tier 1, Billing). |
| Typing indicators & Read receipts | Intercom/Chatwoot | **P0 (MVP)** | Real-time presence showing when customer or agent is drafting a message. |
| Conversation tags / labels | All | **P0 (MVP)** | Flexible tagging for categorization and filtered triage. |
| Rich message attachments | All | **P0 (MVP)** | Secure file and image upload with signed S3 storage URLs. |
| Collision detection | Zendesk | **P1** | Warning indicators when another agent is actively viewing or replying to a thread. |
| Canned responses / Macros | All | **P1** | Pre-written reply templates accessible via quick shortcut (`/macro`). |

---

### Module D: Structured Ticket Management
| Feature | Competitor Equivalent | Priority | Description |
| :--- | :--- | :--- | :--- |
| Ticket creation from conversation | Zendesk/Intercom | **P0 (MVP)** | Escalating a live conversation into a structured ticket. |
| Unique ticket identifiers | Zendesk | **P0 (MVP)** | Human-readable sequential reference numbers (e.g., `TICK-1042`). |
| Ticket status machine | Zendesk | **P0 (MVP)** | `New`, `Open`, `Pending`, `On-Hold`, `Resolved`, `Closed`. |
| Priority classification | Zendesk/Chatwoot | **P0 (MVP)** | `Low`, `Medium`, `High`, `Urgent` severity ratings. |
| Due dates & Target SLAs | Zendesk | **P0 (MVP)** | Setting resolution target deadlines and tracking breach status. |
| Ticket assignment | Zendesk | **P0 (MVP)** | Assignee and group ownership. |
| Audit history / Event log | Zendesk | **P1** | Immutable chronological record of every status change, assignment, and edit. |

---

### Module E: Customer & Contact Management (CRM)
| Feature | Competitor Equivalent | Priority | Description |
| :--- | :--- | :--- | :--- |
| Customer profiles | All | **P0 (MVP)** | Full name, email, phone number, company name, avatar, and timeline. |
| Conversation history | All | **P0 (MVP)** | Chronological view of all previous interactions by the customer. |
| Custom attributes | All | **P0 (MVP)** | Arbitrary key-value metadata (e.g., `subscription_plan: "Pro"`, `mrr: 299`). |
| Customer search & filters | All | **P0 (MVP)** | Fast lookup by email, name, or metadata attribute. |
| Contact merge | Zendesk/Chatwoot | **P1** | Merging duplicate visitor profiles into a unified customer identity. |

---

### Module F: Embeddable Website Live Chat Widget
| Feature | Competitor Equivalent | Priority | Description |
| :--- | :--- | :--- | :--- |
| Lightweight script tag embed | Intercom/Chatwoot | **P0 (MVP)** | Embeddable `<script src=".../widget.js" data-inbox-key="...">` script. |
| Responsive chat popup UI | All | **P0 (MVP)** | Non-intrusive floating launcher button with modal chat window. |
| Anonymous visitor session | Intercom/Chatwoot | **P0 (MVP)** | Generating ephemeral device session token stored in browser localStorage. |
| Identity verification | Intercom/Chatwoot | **P0 (MVP)** | HMAC-SHA256 signature verification preventing visitor impersonation. |
| Custom widget styling | All | **P0 (MVP)** | Configurable brand color, header text, welcome message, and avatar. |
| File attachment upload in widget | All | **P0 (MVP)** | Enabling visitors to upload screenshots and log files directly in the chat. |
| Proactive messages / greeting | Intercom | **P1** | Automatic greeting popup after configurable dwell time on page. |

---

### Module G: Knowledge Base / Self-Service Help Center
| Feature | Competitor Equivalent | Priority | Description |
| :--- | :--- | :--- | :--- |
| Public Help Portal | All | **P0 (MVP)** | Responsive public article index accessible via `/portal/[workspace]`. |
| Article categorization | All | **P0 (MVP)** | Hierarchical organization: Categories -> Articles. |
| Article lifecycle | All | **P0 (MVP)** | Draft, Published, and Archived publication statuses. |
| Full-text search | All | **P0 (MVP)** | Fast customer search across published help articles. |
| Multilingual knowledge base | Zendesk/Intercom | **P2** | Localized versions of articles across multiple language codes. |

---

### Module H: Automation & Workflow Rules
| Feature | Competitor Equivalent | Priority | Description |
| :--- | :--- | :--- | :--- |
| Trigger-Condition-Action engine | Chatwoot/Zendesk | **P0 (MVP)** | Declarative automation rules triggered on conversation events. |
| Auto-assignment rule | All | **P0 (MVP)** | Round-robin or keyword-based routing to specific agent or team. |
| Auto-responder | All | **P0 (MVP)** | Sending out-of-office or welcome message when conversation is created. |
| SLA breach alert | Zendesk | **P1** | Automated notification when first response time exceeds target threshold. |
| Webhook triggers | All | **P1** | Emitting JSON HTTP POST payloads to external endpoints on key events. |

---

### Module I: Reporting & Metrics Analytics
| Feature | Competitor Equivalent | Priority | Description |
| :--- | :--- | :--- | :--- |
| Overview metrics cards | All | **P0 (MVP)** | Real-time counts: Total, Open, Resolved, Average First Response Time (FRT). |
| Conversation volume timeline | All | **P0 (MVP)** | Day/week time-series volume chart (Incoming vs Resolved). |
| Agent performance summary | All | **P0 (MVP)** | Per-agent metrics: assigned, resolved, and average response speed. |
| Customer Satisfaction (CSAT) | All | **P1** | 1-5 star post-resolution customer rating survey. |
| Custom report exports (CSV/PDF) | Zendesk | **P1** | Exporting raw conversation and performance data. |
