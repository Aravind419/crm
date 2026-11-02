# SupportOS Development & Operations Guide

## Prerequisites

- **Node.js**: v20+ (Node v24 supported)
- **Package Manager**: `npm` (v10+) or `pnpm` (v10+)
- **Database**: PostgreSQL 15+ (Production) or SQLite (Local zero-setup development)
- **Redis**: v7+ (Optional for single-instance local dev, required for clustered workers)

---

## Quick Start (Local Setup)

### 1. Clone & Install Dependencies
```bash
cd d:\crm
npm install
```

### 2. Configure Environment Variables
Copy the example environment file:
```bash
cp .env.example .env
```
Ensure required secrets are configured (`JWT_SECRET`, `PORT`, `DATABASE_URL`).

### 3. Initialize Database & Seed Sample Data
```bash
npx prisma generate
npx prisma db push
npm run seed
```
This initializes sample organizations ("Acme SaaS"), teams ("Support Tier 1", "Engineering"), agents (`admin@acme.com` / `agent@acme.com`), sample customers, tickets, and knowledge articles.

### 4. Start Development Servers
```bash
# Start backend API (NestJS + Socket.IO) on http://localhost:4000
npm run dev:api

# Start frontend application (Next.js) on http://localhost:3000
npm run dev:web
```

---

## Running Automated Tests

```bash
# Run unit & API integration tests
npm test

# Run tenant isolation security tests
npm run test:security

# Run end-to-end browser tests (Playwright)
npm run test:e2e
```
