# SupportOS Enterprise Deployment Guide

## 1. System Requirements & Architecture

SupportOS is designed to run in modern containerized cloud environments (AWS ECS, Google Cloud Run, Kubernetes, or Docker Compose on a single Linux VPS).

### Minimum Server Specification:
- **CPU**: 2 vCPUs
- **RAM**: 4 GB RAM
- **Disk**: 20 GB SSD
- **Network**: Public IPv4/IPv6 with TLS 1.3 reverse proxy (Cloudflare, Caddy, or Nginx)

---

## 2. Docker Compose Production Deployment

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: supportos_admin
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: supportos
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    restart: always
    command: redis-server --appendonly yes
    volumes:
      - redisdata:/data
    ports:
      - "6379:6379"

  api:
    build:
      context: .
      dockerfile: Dockerfile.api
    restart: always
    environment:
      NODE_ENV: production
      PORT: 4000
      DATABASE_URL: postgresql://supportos_admin:${POSTGRES_PASSWORD}@postgres:5432/supportos?schema=public
      JWT_SECRET: ${JWT_SECRET}
      CORS_ORIGIN: https://app.yourdomain.com
    depends_on:
      - postgres
      - redis
    ports:
      - "4000:4000"

  web:
    build:
      context: .
      dockerfile: Dockerfile.web
    restart: always
    environment:
      NODE_ENV: production
      PORT: 3000
      NEXT_PUBLIC_API_URL: https://api.yourdomain.com
      NEXT_PUBLIC_SOCKET_URL: https://api.yourdomain.com
      NEXT_PUBLIC_APP_URL: https://app.yourdomain.com
    ports:
      - "3000:3000"

volumes:
  pgdata:
  redisdata:
```

---

## 3. Environment Variables Reference

| Variable | Description | Production Example |
| :--- | :--- | :--- |
| `PORT` | API listen port | `4000` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/supportos?sslmode=require` |
| `JWT_SECRET` | 256-bit cryptographically secure string (>= 32 chars) | Generated via `openssl rand -hex 32` |
| `BILLING_WEBHOOK_SECRET` | Secret key for billing webhook HMAC-SHA256 verification | Generated via `openssl rand -hex 32` |
| `CORS_ORIGIN` | Allowed administrative web origins (comma-separated) | `https://app.yourdomain.com` |
| `ALLOWED_WIDGET_ORIGINS` | Allowed customer embedding origins for public widget | `*` or `https://customer1.com,https://customer2.com` |
| `REDIS_URL` | Redis instance for rate limiting & WebSocket cluster | `redis://redis:6379` |
| `REQUIRE_REDIS` | Fail closed (503) if Redis is unavailable | `true` |
| `TRUST_PROXY` | Trust reverse proxy headers (X-Forwarded-For) | `true` |
| `NEXT_PUBLIC_API_URL` | Public HTTP API endpoint | `https://api.yourdomain.com` |
| `NEXT_PUBLIC_SOCKET_URL`| Public WebSocket endpoint | `https://api.yourdomain.com` |
| `NEXT_PUBLIC_APP_URL` | Public Frontend URL | `https://app.yourdomain.com` |
| `APP_URL` | Verified public application base URL for production widget embeds and invite links | `https://app.yourdomain.com` |
| `SMTP_HOST` | Production SMTP hostname for agent email invitations | `smtp.resend.com` or `smtp.sendgrid.net` |
| `SMTP_PORT` | Production SMTP port | `587` or `465` |
| `SMTP_USER` | Production SMTP username | `resend` or `apikey` |
| `SMTP_PASS` | Production SMTP password / secret | Secret key |
| `SMTP_SECURE` | Use TLS (true for 465, false for 587) | `false` |
| `EMAIL_FROM` | Sender identity on outbound invitation emails | `SupportOS Invitations <invites@yourdomain.com>` |
| `RESEND_API_KEY` | Optional direct Resend API key fallback | `re_...` |

---

## 4. Database Migrations & Initial Setup

```bash
# 1. Run database schema push against target PostgreSQL database
npx prisma db push --schema=prisma/schema.postgresql.prisma

# 2. Apply PostgreSQL Row-Level Security (RLS) policies
psql -h postgres -U supportos_admin -d supportos -f prisma/rls_policies.sql

# 3. Seed initial master organization and administrative accounts
npx tsx prisma/seed.ts
```
