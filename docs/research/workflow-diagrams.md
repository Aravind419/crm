# SupportOS Workflow Diagrams

This document contains Mermaid diagrams illustrating key operational workflows across the platform.

---

## 1. Customer Widget Interaction & Real-Time Ingestion

```mermaid
sequenceDiagram
    autonumber
    actor Customer as Customer / Visitor
    participant Widget as SupportOS Web Widget
    participant Gateway as API Gateway / Ingestion API
    participant DB as PostgreSQL Database
    participant Redis as Redis Pub/Sub & BullMQ
    actor Agent as Support Agent (Workspace)

    Customer->>Widget: Opens widget & enters inquiry
    Widget->>Gateway: POST /api/v1/public/conversations (Inbox Key, Visitor Token)
    Gateway->>DB: Upsert Customer & Create Conversation (Status: Open)
    Gateway->>DB: Insert Initial Message (Type: Incoming)
    Gateway->>Redis: Publish 'conversation:created' & 'message:created'
    Redis->>Agent: WebSocket broadcast to Agent Workspace
    Agent->>Gateway: POST /api/v1/conversations/:id/messages (Public Reply)
    Gateway->>DB: Insert Agent Message
    Gateway->>Redis: Publish 'message:created' (Outgoing)
    Redis->>Widget: Push message via WebSocket
    Widget->>Customer: Display agent reply instantly
```

---

## 2. Conversation & Ticket Escalation Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Ingestion: New Message Received
    
    state Ingestion {
        [*] --> Unassigned: Automation evaluates routing
        Unassigned --> AssignedToAgent: Manual triage or Auto-assign
        Unassigned --> AssignedToTeam: Team routing
        AssignedToTeam --> AssignedToAgent: Team member claims thread
    }
    
    state ActiveConversation {
        AssignedToAgent --> WaitingOnCustomer: Agent replies
        WaitingOnCustomer --> AssignedToAgent: Customer replies
        AssignedToAgent --> InternalReview: Private note / Peer mention
        InternalReview --> AssignedToAgent: Review complete
    }
    
    state TicketEscalation {
        AssignedToAgent --> TicketCreated: Convert to Ticket
        TicketCreated --> TicketInProgress: Assign engineer / SLA timer
        TicketInProgress --> TicketResolved: Fix deployed
        TicketResolved --> TicketClosed: Customer confirmation
    }
    
    ActiveConversation --> Resolved: Agent resolves conversation
    TicketResolved --> Resolved: Auto-sync resolution
    Resolved --> [*]: 30-day archival
    Resolved --> AssignedToAgent: Customer reopens via new message
```

---

## 3. Automation Engine Trigger-Condition-Action Flow

```mermaid
flowchart TD
    A([Event Triggered: e.g. Conversation Created]) --> B[Event Dispatcher / BullMQ Job]
    B --> C[(Fetch Active Automation Rules for Tenant)]
    C --> D{Condition Evaluator}
    
    D -- Condition Met --> E[Execute Action Pipeline]
    D -- Condition Failed --> F[Skip Rule]
    
    subgraph Actions
        E --> E1[Assign Agent / Team]
        E --> E2[Set Priority: High]
        E --> E3[Add Conversation Tags]
        E --> E4[Send Canned Auto-Response]
    end
    
    E1 --> G[(Persist Updates to PostgreSQL)]
    E2 --> G
    E3 --> G
    E4 --> G
    G --> H[Emit WebSocket Broadcasts to Connected Clients]
    H --> I([Rule Execution Logged in Audit Trail])
```

---

## 4. Multi-Tenant Row-Level Security Boundary

```mermaid
flowchart LR
    subgraph Client Requests
        R1[Agent Request from Org A]
        R2[Agent Request from Org B]
    end

    subgraph API Middleware
        Auth[JWT Session & Org Context Extractor]
    end

    subgraph Data Access Layer
        RLS[PostgreSQL Tenant Isolation Filter: WHERE organization_id = $1]
    end

    subgraph Isolated Storage
        OrgA[(Tenant A Data)]
        OrgB[(Tenant B Data)]
    end

    R1 --> Auth
    R2 --> Auth
    Auth --> RLS
    RLS -- Org A Context --> OrgA
    RLS -- Org B Context --> OrgB
```
