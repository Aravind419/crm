# SupportOS Frontend UI/UX & Browser Audit

## 1. Playwright Route Inspection Summary

Using Playwright MCP, each route was inspected in an automated headless browser session:

| Route | Page Name | HTTP Status | Console Errors | Layout / UI State |
| :--- | :--- | :--- | :--- | :--- |
| `/` | Landing Page | 200 | 0 | Responsive hero, feature cards, navigation links all functional. |
| `/pricing` | Pricing Page | 200 | 0 | 3-tier matrix (Team ₹799, Business ₹1,499, Enterprise) rendered. |
| `/login` | Sign In Page | 200 | 0 | Authentication form + quick evaluation profile presets. |
| `/signup` | Onboarding | 200 | 0 | Self-service tenant creation form. |
| `/inbox` | Shared Inbox | 200 | 0 | 3-pane layout, real-time message stream, dual-mode composer (Public Reply vs Private Internal Note). |
| `/tickets` | Ticket Hub | 200 | 0 | Structured ticket table (`TICK-1001` through `TICK-1004`), status filters, create modal. |
| `/customers`| Customer CRM | 200 | 0 | Customer directory, JSON metadata attributes inspector, touchpoint history. |
| `/reports` | Analytics | 200 | 0 | Real-time KPI cards (Total Convs: 6, FRT: 35m), 7-day volume chart, agent leaderboard. |
| `/settings` | Settings CMS | 200 | 0 | Inboxes, copy-paste script tag snippet, teams, agent invitation flow. |
| `/portal/acme` | Public Portal | 200 | 0 | Customer-facing documentation search, category list, article reader. |
| `/widget-demo` | Live Widget Demo | 200 | 0 | Simulated customer storefront with dynamically injected `widget.js`. |

---

## 2. Interactive Component Evaluation

### 2.1 Dual-Mode Composer Behavior
- Switching between "Public Reply" and "Internal Note":
  - Successfully updates composer container background and border to warm amber (`bg-amber-50/80`).
  - Textarea placeholder updates to prompt for private team notes.
  - Button text updates to "Add Private Note".
  - Posts with `messageType: 'INTERNAL_NOTE'` which is strictly excluded from public widget APIs.

### 2.2 Live Chat Widget (`widget.js`)
- Launcher button appears at bottom-right (`#supportos-launcher-btn`).
- Clicking launcher toggles chat drawer (`#supportos-chat-window`).
- Pre-chat form captures Visitor Name, Email, and initial inquiry.
- Submits to `/api/v1/public/conversations`, storing persistent `visitorToken` in localStorage.
- Real-time polling updates messages every 3 seconds while open.
