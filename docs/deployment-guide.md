# SupportOS Enterprise Deployment Guide

## 1. System Requirements & Architecture

SupportOS is designed to run in modern containerized cloud environments (AWS ECS, Google Cloud Run, Kubernetes, or Docker Compose on a single Linux VPS) paired with managed PostgreSQL (e.g., Neon Serverless PostgreSQL or AWS RDS Aurora).

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
      POSTGRES_PASSWORD: ${POSTGRES_ADMIN_PASSWORD}
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
      # Dedicated runtime unprivileged role
      DATABASE_URL: postgresql://supportos_app:${APP_ROLE_PASSWORD}@postgres:5432/supportos?schema=public
      DIRECT_URL: postgresql://supportos_admin:${POSTGRES_ADMIN_PASSWORD}@postgres:5432/supportos?schema=public
      JWT_SECRET: ${JWT_SECRET}
      BILLING_WEBHOOK_SECRET: ${BILLING_WEBHOOK_SECRET}
      CORS_ORIGIN: https://app.yourdomain.com
      REDIS_URL: redis://redis:6379
      REQUIRE_REDIS: "true"
      APP_URL: https://app.yourdomain.com
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
| `DATABASE_URL` | Restricted runtime role (`supportos_app`) with connection pooling | `postgresql://supportos_app:SECRET@ep-round-recipe-pooler.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require` |
| `DIRECT_URL` | Administrative DDL owner role (`neondb_owner`) for migrations | `postgresql://neondb_owner:SECRET@ep-round-recipe.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require` |
| `APP_ROLE_PASSWORD` | Password for `supportos_app` provisioning / credential rotation | Cryptographically strong password |
| `JWT_SECRET` | 256-bit cryptographically secure string (>= 32 chars) | Generated via `openssl rand -hex 32` |
| `BILLING_WEBHOOK_SECRET` | Secret key for billing webhook HMAC-SHA256 verification (>= 32 chars) | Generated via `openssl rand -hex 32` |
| `CORS_ORIGIN` | Allowed administrative web origins (comma-separated, no wildcards) | `https://app.yourdomain.com` |
| `ALLOWED_WIDGET_ORIGINS` | Allowed customer embedding origins for public widget | `*` or `https://customer1.com,https://customer2.com` |
| `REDIS_URL` | Redis connection string for distributed rate limiting & WebSockets | `redis://redis:6379` |
| `REQUIRE_REDIS` | Fail closed (503) if Redis is unavailable | `true` |
| `TRUST_PROXY` | Trust reverse proxy headers (`X-Forwarded-For`) | `true` |
| `NEXT_PUBLIC_API_URL` | Public HTTP API endpoint | `https://api.yourdomain.com` |
| `NEXT_PUBLIC_SOCKET_URL`| Public WebSocket endpoint | `https://api.yourdomain.com` |
| `NEXT_PUBLIC_APP_URL` | Public Frontend URL | `https://app.yourdomain.com` |
| `APP_URL` | Verified public application base URL for widget embeds and invites | `https://app.yourdomain.com` |
| `SMTP_HOST` | Production SMTP hostname for agent email invitations | `smtp.resend.com` or `smtp.sendgrid.net` |
| `SMTP_PORT` | Production SMTP port | `587` or `465` |
| `SMTP_USER` | Production SMTP username | `resend` or `apikey` |
| `SMTP_PASS` | Production SMTP password / secret | Secret key |
| `SMTP_SECURE` | Use TLS (`true` for 465, `false` for 587) | `false` |
| `EMAIL_FROM` | Sender identity on outbound invitation emails | `SupportOS <invites@yourdomain.com>` |
| `RESEND_API_KEY` | Optional direct Resend API key fallback | `re_...` |

---

## 4. Zero-Trust PostgreSQL Roles & Row-Level Security

To prevent catastrophic cross-tenant data exfiltration and enforce zero-trust database defense-in-depth, SupportOS strictly decouples schema administration from application runtime:

1. **Migration / DDL Role (`DIRECT_URL`)**:
   - Role: `neondb_owner` / `supportos_admin`.
   - Capabilities: `SUPERUSER` or table owner.
   - Purpose: Applies Prisma schema migrations, DDL adjustments, and role provisioning. Never used by live HTTP or background request handlers.

2. **Application Runtime Role (`DATABASE_URL`)**:
   - Role: `supportos_app`.
   - Capabilities: `NOSUPERUSER`, `NOBYPASSRLS`, zero table ownership.
   - Purpose: Executes all API requests, background workers, and Socket.IO queries.
   - Access Permissions: Minimal DML (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) on application tables. Explicitly prohibited from `TRUNCATE`, `TRIGGER`, or accessing `_prisma_migrations`.
   - Row-Level Security (RLS): PostgreSQL kernel enforces tenant isolation on all tables via `current_setting('app.current_organization_id', true)`.

### Step-by-Step Production Database Provisioning

```bash
# Step 1: Run schema migrations using the administrative owner role (DIRECT_URL)
npx prisma migrate deploy --schema=prisma/schema.postgresql.prisma

# Step 2: Provision or rotate the unprivileged supportos_app role and RLS policies
# Requires DIRECT_URL and APP_ROLE_PASSWORD in the environment
APP_ROLE_PASSWORD="<GENERATED_STRONG_PASSWORD>" npm run db:provision-roles

# Step 3: Seed initial organization, admin accounts, and default inbox
npx tsx prisma/seed.ts

# Step 4: Verify RLS policies and table ownership via catalog inspection
npm --prefix apps/api run test:postgres-rls
```

---

## 5. Enterprise Backup, Disaster Recovery & High Availability

### 5.1 Automated Point-in-Time Recovery (PITR)
- **Continuous Write-Ahead Logging (WAL)**: Production PostgreSQL instances must retain WAL archives allowing Point-in-Time Recovery to any second within a 30-day retention window.
- **Neon Cloud PITR**: When hosted on Neon Serverless PostgreSQL, PITR is natively supported via instant point-in-time branch creation. In the event of catastrophic data corruption or human error, a branch can be restored instantaneously to any historical timestamp without service interruption.

### 5.2 Automated Logical Backups (Daily Snapshots)
In addition to WAL archiving, an automated scheduled job must export and encrypt daily logical dumps:

```bash
# Daily logical backup script (cron / Kubernetes CronJob)
BACKUP_TIMESTAMP=$(date -u +"%Y%m%d_%H%M%SZ")
BACKUP_FILE="/backups/supportos_backup_${BACKUP_TIMESTAMP}.dump"

pg_dump "$DIRECT_URL" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --file="$BACKUP_FILE"

# Encrypt backup with AES-256 and replicate to offsite cold object storage (AWS S3 Glacier / Cloudflare R2)
gpg --symmetric --cipher-algo AES256 --batch --yes --passphrase "$BACKUP_ENCRYPTION_KEY" "$BACKUP_FILE"
aws s3 cp "${BACKUP_FILE}.gpg" "s3://${BACKUP_S3_BUCKET}/postgres/supportos_${BACKUP_TIMESTAMP}.dump.gpg"
```

### 5.3 Disaster Recovery Runbook (RTO & RPO Objectives)
- **Target Recovery Point Objective (RPO)**: < 5 minutes (via continuous WAL streaming).
- **Target Recovery Time Objective (RTO)**: < 30 minutes (automated container restart and branch failover).

**Restoration Procedure:**
1. Provision target clean PostgreSQL cluster with matching major engine version (PostgreSQL 16+).
2. Decrypt offsite backup:
   ```bash
   gpg --decrypt --batch --passphrase "$BACKUP_ENCRYPTION_KEY" supportos_backup.dump.gpg > supportos_backup.dump
   ```
3. Restore database schema and records:
   ```bash
   pg_restore --clean --if-exists --no-owner -d "$RESTORE_DIRECT_URL" supportos_backup.dump
   ```
4. Re-apply Row-Level Security policies and unprivileged role definitions:
   ```bash
   APP_ROLE_PASSWORD="$APP_ROLE_PASSWORD" npm run db:provision-roles
   ```
5. Verify application data integrity:
   ```bash
   npm --prefix apps/api run test:postgres-rls
   npm --prefix apps/api run test:security
   npm run audit:runtime
   ```
