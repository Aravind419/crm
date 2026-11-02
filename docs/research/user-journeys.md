# SupportOS User Journeys

This document defines the core end-to-end user journeys for the primary personas using SupportOS:
1. **Visitor / Customer** (Seeking assistance via the live chat widget or knowledge base)
2. **Support Agent** (Triage, real-time messaging, internal collaboration, and resolution)
3. **Support Team Lead / Admin** (Configuration, agent management, automation, reporting)

---

## Journey 1: Customer Initiates Support via Embeddable Widget

### Persona: Priya (Online Customer on an E-commerce Platform)
- **Goal**: Inquire about order status and resolve a delivery query quickly.

```
Step 1: Visitor lands on customer website containing SupportOS script tag.
Step 2: Floating launcher button appears at bottom-right corner.
Step 3: Priya clicks launcher; chat popup opens displaying tenant branding and greeting.
Step 4: Priya inputs Name ("Priya Sharma"), Email ("priya@example.com"), and initial inquiry.
Step 5: Widget calls `/api/v1/public/conversations` with tenant's public inbox key.
Step 6: System creates or associates Customer record, creates Conversation, and streams initial message.
Step 7: Real-time Socket.IO connection is established for the visitor session.
Step 8: Priya receives instant visual confirmation of message delivery and agent typing indicator.
Step 9: Priya uploads an order screenshot attachment.
Step 10: Agent responds; Priya views reply in real time and completes inquiry.
```

---

## Journey 2: Support Agent Manages and Resolves Conversation

### Persona: Rahul (Customer Support Specialist at SaaS Company)
- **Goal**: Respond to incoming customer inquiries, coordinate with engineering via internal note, and resolve issue.

```
Step 1: Rahul opens the SupportOS Agent Workspace (`/inbox`).
Step 2: Real-time notification sound and toast trigger as a new unassigned conversation arrives in the "Unassigned" queue.
Step 3: Rahul clicks the conversation thread.
Step 4: The 3-pane interface displays:
        - Left: Inbox views (Unassigned, Mine, All Open, Resolved)
        - Center: Message conversation stream with timestamps and read receipts
        - Right: Customer context sidebar (Priya's email, past conversations, custom attributes)
Step 5: Rahul clicks "Assign to Me". The state immediately transitions across all connected agent views.
Step 6: Rahul switches composer mode to "Internal Note" (yellow highlight indicator).
Step 7: Rahul writes: "@suresh Please confirm if batch #9822 has cleared dispatch." (Only visible to internal team).
Step 8: Rahul switches back to "Public Reply", writes the solution to Priya, and clicks Send.
Step 9: Message is broadcasted to Priya's widget in sub-second latency.
Step 10: Rahul marks the conversation as "Resolved". The thread smoothly moves to the "Resolved" queue.
```

---

## Journey 3: Escalating a Conversation to a Structured Ticket

### Persona: Sneha (Tier 2 Technical Support Engineer)
- **Goal**: Track a complex software bug requiring engineering escalation with SLA guarantees.

```
Step 1: Sneha receives a conversation reporting an unexpected database timeout error.
Step 2: In the conversation header, Sneha clicks "Create Ticket".
Step 3: A ticket creation modal opens pre-filled with:
        - Title: "Database timeout during bulk CSV import"
        - Customer: Associated customer profile
        - Priority: High
        - Team: "Platform Engineering"
        - Due Date: Set according to SLA policy (4 hours)
Step 4: System generates sequential identifier `TICK-1089` and establishes a bi-directional link with the original conversation.
Step 5: Sneha monitors the ticket in the dedicated `/tickets` view.
Step 6: Status updates (`New` -> `In Progress` -> `Resolved`) are logged in the ticket audit trail.
Step 7: Once fixed, resolving the ticket automatically notifies the customer on the linked conversation channel.
```

---

## Journey 4: Admin Configures Automation Rule & Team Routing

### Persona: Amit (Customer Support Director)
- **Goal**: Ensure all billing-related incoming inquiries are automatically assigned to the Finance Support team.

```
Step 1: Amit logs into SupportOS and navigates to `Settings -> Automations`.
Step 2: Amit clicks "New Automation Rule".
Step 3: Form configuration:
        - Trigger: `Conversation Created`
        - Conditions:
            - Message body contains any of `["invoice", "refund", "billing", "payment", "charge"]`
        - Actions:
            - Assign Team: `Finance & Billing`
            - Set Priority: `High`
            - Add Tag: `billing-inquiry`
            - Send Automated Response: "We have routed your request to our Billing Specialists. Expect a reply within 2 hours."
Step 4: Amit saves and activates the rule.
Step 5: A incoming customer message matching "Where can I download my invoice?" triggers the rule.
Step 6: Conversation is instantly routed to the Finance team inbox without manual triage.
```

---

## Journey 5: Customer Searches Knowledge Base Self-Service

### Persona: Vikram (Product User)
- **Goal**: Find setup instructions without waiting for a support agent.

```
Step 1: Vikram visits the organization's public help center at `/portal/acme-corp`.
Step 2: Vikram enters "webhook configuration" into the search bar.
Step 3: Real-time search debounces and presents matching articles with category breadcrumbs.
Step 4: Vikram clicks "Setting Up Webhook Endpoints".
Step 5: Clean, accessible article layout loads with syntax-highlighted code samples and step-by-step guides.
Step 6: Vikram clicks "Yes, this article was helpful", recording positive CSAT deflection.
Step 7: Support deflection is achieved; zero agent bandwidth consumed.
```
