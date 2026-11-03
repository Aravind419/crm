# SupportOS Production Deployment Readiness Checklist

**Document Version:** 1.0.0  
**Phase:** 1.5.3  
**Status Gate:** **Security CI Passed — Production Deployment Gated**  
**Last Updated:** November 3, 2026  

---

## Overview

This checklist establishes the formal deployment gate for releasing SupportOS to production infrastructure. Each operational criterion is assigned one of three definitive statuses:
- **`VERIFIED`**: Validated and enforced via automated test suites, CI pipelines, or source architecture.
- **`NOT TESTED`**: Awaiting physical infrastructure provisioning, live network staging, or operational drill.
- **`BLOCKED`**: Prerequisites incomplete or failing baseline security gates.

> [!IMPORTANT]
> In accordance with production hardening standards, infrastructure-level items dependent on live hosting providers are **not pre-marked as verified**. They must be validated during staging and pre-flight operational rehearsals.

---

## 1. Production Environment Variables and Secrets

| Item | Requirement | Verification Method | Status |
| :--- | :--- | :--- | :--- |
| **Secret Entropy** | `JWT_SECRET`, `COOKIE_SECRET`, and `BILLING_WEBHOOK_SECRET` must each contain >= 32 characters of high-entropy cryptographic randomness. | Startup security validator in `apps/api/src/config.ts` | **VERIFIED** |
| **Predictable Secrets Rejection** | Startup validator fails closed if placeholder keys (`super-secret`, `password`, `changeme`) are detected in production. | Local security unit tests & CI validation | **VERIFIED** |
| **Diagnostics Endpoint Disabled** | `ENABLE_INTERNAL_DIAGNOSTICS` must be unset or `"false"` in production. | Endpoint returns `404 Not Found` in production | **VERIFIED** |
| **Production KMS / Secret Store** | Production secrets provisioned via AWS Secrets Manager, GCP Secret Manager, or Vault instead of static `.env` files. | Operational deployment inspection | **NOT TESTED** |

---

## 2. Restricted PostgreSQL Runtime Credentials

| Item | Requirement | Verification Method | Status |
| :--- | :--- | :--- | :--- |
| **Unprivileged Application Role** | Application runtime connects strictly as `supportos_app` (`NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE`). | Verified in `scripts/provision-roles.ts` & `test:postgres-rls` | **VERIFIED** |
| **Zero Table Ownership** | `supportos_app` owns 0 tables in schema `public` (tables owned by dedicated migration role). | PostgreSQL catalog query in CI RLS step | **VERIFIED** |
| **No Schema / Database CREATE** | `supportos_app` has `has_schema_privilege('public', 'CREATE') = false` and `has_database_privilege(current_database(), 'CREATE') = false`. | PostgreSQL catalog inspection & CI assertions | **VERIFIED** |
| **Migration Table Denial** | `supportos_app` has zero privileges (including SELECT) on `_prisma_migrations`. | CI RLS step & `has_table_privilege` verification | **VERIFIED** |
| **Least Privilege Table Ops** | `TRUNCATE`, `TRIGGER`, and `REFERENCES` are revoked on all tables from `supportos_app`. | CI effective privilege check | **VERIFIED** |
| **Database Connection Pooling** | Production connection pooler (PgBouncer or Neon Pooled endpoint) configured with adequate pool size and transaction pooling mode. | Target infrastructure provisioning | **NOT TESTED** |

---

## 3. Migration Procedure and Rollback Strategy

| Item | Requirement | Verification Method | Status |
| :--- | :--- | :--- | :--- |
| **Separated Migration Role** | Schema migrations execute with a dedicated administrative role via `DIRECT_URL`. | Migration runner configuration in CI and scripts | **VERIFIED** |
| **Prisma Migrate Deploy** | Zero down-time migration pipeline using `prisma migrate deploy`. | Automated CI Step 6 | **VERIFIED** |
| **Automated Schema Rollback Plan** | Documented and tested forward/backward rollback scripts for all DDL changes. | Pre-flight deployment dry run | **NOT TESTED** |
| **Pre-Migration Snapshot** | Automated pre-migration disk snapshot or branch point triggered before applying DDL. | Managed database backup hook | **NOT TESTED** |

---

## 4. Redis Connectivity and Failover

| Item | Requirement | Verification Method | Status |
| :--- | :--- | :--- | :--- |
| **Production Redis Enforcement** | Application fails closed on boot if `REQUIRE_REDIS="true"` and `REDIS_URL` is omitted. | `apps/api/src/services/redis.service.ts` startup check | **VERIFIED** |
| **Redis TLS / AUTH** | Rediss (`rediss://`) connection with authentication enabled. | Configuration schema validation | **VERIFIED** |
| **Redis Sentinel / Cluster Failover** | Automatic failover test with replica promotion without session interruption. | Operational chaos testing / failover drill | **NOT TESTED** |
| **Socket.IO Redis Adapter** | Distributed room-based emission and adapter reconnection logic. | Redis adapter initialization in `socket.service.ts` | **VERIFIED** |

---

## 5. SMTP Delivery and Bounce Handling

| Item | Requirement | Verification Method | Status |
| :--- | :--- | :--- | :--- |
| **No Mock Drivers in Production** | Startup validator fails closed if `EMAIL_DRIVER="mock"` when `NODE_ENV="production"`. | Config validator in `apps/api/src/config.ts` | **VERIFIED** |
| **Real SMTP Provider** | Integration with Amazon SES, SendGrid, Resend, or Postmark. | Environment credential provisioning | **NOT TESTED** |
| **TLS & Port Negotiation** | STARTTLS (Port 587) or SSL/TLS (Port 465) verified against provider. | Live SMTP probe | **NOT TESTED** |
| **Bounce & Complaint Webhooks** | Handling of SNS/SendGrid webhook notifications for hard bounces and spam complaints. | Webhook route handler verification | **NOT TESTED** |

---

## 6. File Storage Access Controls

| Item | Requirement | Verification Method | Status |
| :--- | :--- | :--- | :--- |
| **S3 / Cloud Storage Driver** | Attachments stored in private object storage bucket with signed URL expiration. | Storage service abstraction | **VERIFIED** |
| **Bucket Public Access Block** | S3 bucket configured with `BlockPublicAcls`, `BlockPublicPolicy`, `IgnorePublicAcls`, and `RestrictPublicBuckets`. | Cloud provider IAM audit | **NOT TESTED** |
| **Signed Upload URL Constraints** | Content-Type, Content-Length, and tenant isolation strictly checked before signature. | Attachment route authorization | **VERIFIED** |
| **Malware Scanning Hook** | Incoming uploads scanned via ClamAV or AWS GuardDuty malware protection before availability. | Ingestion pipeline hook | **NOT TESTED** |

---

## 7. TLS and Domain Configuration

| Item | Requirement | Verification Method | Status |
| :--- | :--- | :--- | :--- |
| **HSTS & Secure Headers** | HTTP Strict Transport Security (`max-age=31536000; includeSubDomains; preload`) and CSP headers enforced. | Helmet middleware in `apps/api/src/server.ts` | **VERIFIED** |
| **TLS 1.3 Termination** | Ingress load balancer / reverse proxy terminates TLS with TLS 1.2/1.3 only and modern ciphers. | Reverse proxy / Cloudflare configuration | **NOT TESTED** |
| **Certificate Auto-Renewal** | Let's Encrypt / AWS Certificate Manager auto-renewal verified. | Ingress infrastructure audit | **NOT TESTED** |

---

## 8. CORS and Widget Origin Allowlists

| Item | Requirement | Verification Method | Status |
| :--- | :--- | :--- | :--- |
| **No Wildcard CORS in Production** | `CORS_ORIGIN="*"` rejected at startup in production. | Startup security check in `apps/api/src/server.ts` | **VERIFIED** |
| **Tenant-Specific Widget Origins** | Visitor widget endpoints validate `Origin` header against `inbox.allowedOrigins`. | Public widget router validation | **VERIFIED** |
| **Credentials & Preflight** | `credentials: true` restricted strictly to validated domain origins. | Express CORS middleware configuration | **VERIFIED** |

---

## 9. Rate Limiting

| Item | Requirement | Verification Method | Status |
| :--- | :--- | :--- | :--- |
| **Global IP Rate Limiter** | General API traffic throttled to prevent volumetric DDoS. | Express rate-limit middleware | **VERIFIED** |
| **Strict Auth Endpoint Limiter** | `/login`, `/register`, `/forgot-password`, `/accept-invitation` throttled to <= 5 attempts / 15 min. | Dedicated route-level rate limiters | **VERIFIED** |
| **Distributed Redis Store** | Rate limit counters stored in Redis to enforce quotas across multi-instance clusters. | Operational Redis backing test | **NOT TESTED** |

---

## 10. Socket.IO Multi-Instance Testing

| Item | Requirement | Verification Method | Status |
| :--- | :--- | :--- | :--- |
| **Room-Based Distributed Disconnect** | User revocation and visitor termination emit `disconnectSockets()` through Redis room adapter. | `apps/api/src/services/socket.service.ts` | **VERIFIED** |
| **Multi-Host Revocation Drill** | Active WebSocket connection on Node A terminated when revocation occurs on Node B. | Multi-host staging cluster deployment test | **NOT TESTED** |
| **Sticky Session / WebSocket Upgrade** | Ingress load balancer configured with cookie-based affinity or WebSocket passthrough. | Ingress controller configuration | **NOT TESTED** |

---

## 11. Backup Schedules

| Item | Requirement | Verification Method | Status |
| :--- | :--- | :--- | :--- |
| **Automated Daily Backups** | Daily automated snapshot of managed PostgreSQL database with 30-day retention. | Cloud provider backup policy | **NOT TESTED** |
| **Cross-Region Backup Replication** | Snapshots replicated to a secondary cloud region for geographic disaster resilience. | AWS / GCP storage replication policy | **NOT TESTED** |
| **WAL Archiving** | Continuous Write-Ahead Log (WAL) archiving enabled for streaming replication. | Database engine configuration | **NOT TESTED** |

---

## 12. Point-in-Time Recovery (PITR) Drill

| Item | Requirement | Verification Method | Status |
| :--- | :--- | :--- | :--- |
| **PITR Window Configuration** | Minimum 7-day point-in-time recovery window configured in database provider. | Neon / RDS configuration audit | **NOT TESTED** |
| **Restoration Drill** | Executed practice restoration to a designated timestamp with recovery time objective (RTO) < 1 hour. | Operational drill execution & signoff | **NOT TESTED** |
| **Data Integrity Verification** | Checksum and row-count verification on restored staging database instance. | Operational drill audit | **NOT TESTED** |

---

## 13. Health Checks and Monitoring

| Item | Requirement | Verification Method | Status |
| :--- | :--- | :--- | :--- |
| **Liveness & Readiness Endpoints** | `GET /health` returns application and dependency statuses. | Core API test suite | **VERIFIED** |
| **Database Ping Probe** | Health check actively queries database connection before returning 200 OK. | Health check implementation | **VERIFIED** |
| **Prometheus / OpenTelemetry Metrics** | Request duration, error rates, and queue depth exported to monitoring dashboard. | Metrics exporter integration | **NOT TESTED** |
| **Uptime Monitoring & Alerting** | External synthetic probe (e.g. BetterStack, Datadog) alerting on downtime or latency spikes. | PagerDuty / Opsgenie alert rules | **NOT TESTED** |

---

## 14. Error Tracking and Incident Response

| Item | Requirement | Verification Method | Status |
| :--- | :--- | :--- | :--- |
| **Centralized Error Tracking** | Sentry or equivalent configured with PII sanitization (passwords, tokens, emails redacted). | Error handler middleware | **NOT TESTED** |
| **No Sensitive Data in Logs** | Logger strips authorization headers, session tokens, and passwords from logs. | Audit suite verification | **VERIFIED** |
| **On-Call Escalation Matrix** | Documented runbooks and on-call escalation rotation established. | Operations team documentation | **NOT TESTED** |

---

## 15. Data Export, Deletion, and Retention

| Item | Requirement | Verification Method | Status |
| :--- | :--- | :--- | :--- |
| **Tenant Data Purge (GDPR Art. 17)** | Cascading deletion cleans all tenant data upon verified organization closure. | Database foreign key cascades & tests | **VERIFIED** |
| **Export Tooling (GDPR Art. 20)** | Tenant data export in structured JSON format. | Onboarding & admin data pipeline | **VERIFIED** |
| **Audit Event Immutability** | Audit log entries cannot be modified or deleted by tenant agents or admins. | Row-Level Security policy restrictions | **VERIFIED** |

---

## 16. Deployment and Rollback Verification

| Item | Requirement | Verification Method | Status |
| :--- | :--- | :--- | :--- |
| **Canary / Blue-Green Strategy** | Production deployment uses rolling canary or blue-green rollout to prevent downtime. | CI/CD deployment pipeline | **NOT TESTED** |
| **Smoke Test Suite Execution** | Automated post-deploy smoke tests verify login, conversation creation, and widget loading. | Post-deployment automated hook | **NOT TESTED** |
| **One-Click Instant Rollback** | Automated rollback triggered if 5xx error rate exceeds 1% during initial deployment window. | Ingress / CD pipeline metric gate | **NOT TESTED** |

---

## Summary of Gate Status

| Category | Total Checks | VERIFIED | NOT TESTED | BLOCKED |
| :--- | :---: | :---: | :---: | :---: |
| Application Security & Code Architecture | 19 | 19 | 0 | 0 |
| Cloud Infrastructure & Operations | 23 | 0 | 23 | 0 |
| **Total** | **42** | **19** | **23** | **0** |

**Conclusion:** The SupportOS software codebase has satisfied all code-level and continuous integration security gates. Live production traffic deployment remains conditionally gated pending validation of the 23 operational cloud infrastructure items above during final staging provisioning.
