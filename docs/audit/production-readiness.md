# SupportOS — Production Readiness & Deployment Hardening Guide

**Review Date:** November 2026  
**Auditor Roles:** Principal Application Security Engineer, Senior Backend Architect, DevSecOps Specialist  
**Platform Version:** SupportOS 1.0.0 Baseline  
**Overall Readiness Verdict:** **STAGING READY — PRODUCTION SUBJECT TO INFRASTRUCTURE PREREQUISITES**

---

## 1. Production Readiness Scorecard

| Domain | Implementation & Defense Mechanism | Audit Status |
| :--- | :--- | :--- |
| **Code Originality** | Clean-room implementation, independent product identity, zero copied code. | **VERIFIED** |
| **API Functionality** | All core CRUD, dual-mode messaging, ticket escalations, automations verified. | **VERIFIED** |
| **Visitor Auth & IDOR** | Cryptographic SHA-256 session hash lookup; strict conversation binding. | **VERIFIED** |
| **Real-Time Gateway** | Distributed room-based session revocation disconnection; origin security enforced. | **VERIFIED** |
| **Token Lifecycle & Concurrency** | Token family tracking (`familyId`), CAS rotation, 10s grace window for concurrency races, targeted family revocation. | **VERIFIED** |
| **Billing Webhook Security** | Strict canonical `${timestamp}.${rawPayload}` HMAC, mandatory 300s timestamp, mandatory event ID, atomic DB transaction with `WebhookEvent` unique constraint. | **VERIFIED** |
| **Distributed Rate Limiting** | Redis Lua script rate limiter with safe IP extraction; 503 fail-safe on outage; single-instance in-memory fallback. | **VERIFIED** |
| **Multi-Tenant Security** | Server-side tenant resolution on all queries; PostgreSQL RLS policies in `prisma/rls_policies.sql`. Verified in GitHub Actions PostgreSQL service job. | **VERIFIED** |
| **Password Migration** | Automatic in-place migration on login to bcrypt with timing-safe legacy SHA-256 fallback. Seed modernized to bcrypt. | **VERIFIED** |
| **CI/CD Pipeline** | Dual-job GitHub Actions workflow: SQLite core suite + PostgreSQL 16 & Redis 7 service verification. | **VERIFIED** |
| **Dependency Security** | `deepmerge-ts` resolved; automated `audit:check` in CI; build-time PostCSS exception documented. | **PARTIALLY VERIFIED** |
| **Containerization** | Multi-stage Dockerfiles for API and Web; compose orchestration defined. | **NOT TESTED** in cloud cluster |
| **Observability** | Audit events persisted to database; structured JSON logging and APM pending production setup. | **PARTIALLY VERIFIED** |

---

## 2. Infrastructure & Distributed Deployment Architecture

### Single-Instance vs Multi-Instance Redis Clustering
SupportOS supports two deployment modes:
1. **Single-Node Deployment (Default / Staging)**:
   - Uses in-memory Socket.IO adapter and sliding-window rate limiters.
   - Requires single-instance container deployment or sticky sessions at the reverse proxy.
2. **Multi-Node Clustered Deployment (Production Scale)**:
   - Configure `REDIS_URL=redis://redis-cluster:6379`.
   - Socket.IO uses `@socket.io/redis-adapter` for distributed pub/sub room clustering across API nodes.
   - Rate limiting uses atomic Redis Lua script counter across all nodes.
   - Configure `REQUIRE_REDIS=true` to enforce distributed rate limiting with a 503 fail-safe if Redis becomes unavailable.

---

## 3. Production Environment Configuration Checklist

Before initiating production traffic, inject the following secrets from AWS Secrets Manager, HashiCorp Vault, or GCP Secret Manager:

```ini
# Core Environment
NODE_ENV=production
PORT=4000
DATABASE_URL=postgresql://supportos_app:[STRONG_DB_PASSWORD]@postgres.internal:5432/supportos_prod?schema=public

# Authentication & Cryptography (Generate with: openssl rand -base64 64)
JWT_SECRET=[MANDATORY_HIGH_ENTROPY_64_CHAR_SECRET]
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_DAYS=30

# Billing Webhook Security (Generate with: openssl rand -hex 32)
BILLING_WEBHOOK_SECRET=[MANDATORY_HIGH_ENTROPY_SECRET]

# Distributed Infrastructure
REDIS_URL=redis://redis-cluster.internal:6379
REQUIRE_REDIS=true
TRUST_PROXY=true

# Origin Security Policies
CORS_ORIGIN=https://app.supportos.io,https://admin.supportos.io
ALLOWED_WIDGET_ORIGINS=*

# Public URLs
API_PUBLIC_URL=https://api.supportos.io
WEB_PUBLIC_URL=https://app.supportos.io
```

---

## 4. Operational Runbook & Remaining Production Prerequisites

1. **PostgreSQL Database Migration**:
   - Run `npx prisma migrate deploy --schema=prisma/schema.postgresql.prisma` on production database cluster.
   - Enable PostgreSQL Row-Level Security policies.
2. **Reverse Proxy Configuration**:
   - Configure reverse proxy (Cloudflare / NGINX / AWS ALB) with `TRUST_PROXY=true`.
   - Terminate TLS 1.3 at proxy.
3. **Dependency Maintenance**:
   - Monitor Next.js releases for upstream fix of build-time PostCSS advisory (GHSA-qx2v-qp2m-jg93). Upgrade when Next.js 16 reaches production stability.
