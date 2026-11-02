# SupportOS Unresolved Questions & Architectural Decisions

## 1. Decision Log & Open Questions

| Question / Decision Point | Options Evaluated | Current Architectural Resolution | Impact / Future Review |
| :--- | :--- | :--- | :--- |
| **Monorepo vs. Multi-repo Structure** | A) Single root monorepo (Turborepo)<br>B) Integrated full-stack Next.js app with embedded API & WebSocket server<br>C) Separate backend (`server/`) and frontend (`client/`) packages | **Decision: Option C (Clean Monorepo with `apps/api` and `apps/web` or root-level clean separation)**: Clear process isolation, distinct deployment artifacts, independent scaling. | Ensures backend can run multiple worker processes and WebSocket gateways without Next.js build bloat. |
| **Database Isolation Model** | A) Separate database per tenant<br>B) Separate schema per tenant (`CREATE SCHEMA tenant_x`)<br>C) Shared database with column-level tenant ID (`WHERE organization_id = ...`) | **Decision: Option C (Column-level multi-tenancy with PostgreSQL indexes & RLS ready)**: Maximizes operational simplicity, cost efficiency, and connection pool sharing for hundreds of SMB/mid-market tenants. | Large enterprise customers requiring dedicated DBs can be deployed on single-tenant containers in Enterprise tier. |
| **Authentication Strategy** | A) Third-party auth (Clerk, Auth0, Supabase)<br>B) Self-contained custom JWT + Argon2id / Better-Auth | **Decision: Option B (Self-contained JWT + Argon2id)**: Zero external vendor lock-in, zero per-MAU costs, full support for on-premise / private cloud deployments. | Enterprise SSO (SAML 2.0 / OIDC) will interface through standard Passport / OAuth strategy adapters. |
| **Object Storage for Attachments** | A) Local disk filesystem<br>B) AWS S3 / Cloudflare R2 / MinIO with pre-signed URLs | **Decision: Option B (S3-compatible storage with local fallback)**: Pre-signed upload/download URLs keep media payloads off Node.js event loop while enabling MinIO for local dev. | Eliminates server I/O bottleneck during large screenshot/attachment uploads. |
| **Live Chat Widget Communication** | A) Long-polling HTTP<br>B) Server-Sent Events (SSE)<br>C) Bi-directional WebSocket (Socket.IO) | **Decision: Option C (Socket.IO)**: Low latency, built-in fallback to HTTP long-polling if corporate firewalls block WebSockets, native room management. | Consistent protocol across agent workspace and public widget. |

---

## 2. Risk Register & Mitigations

1. **Risk: Cross-Tenant Data Leakage (IDOR)**:
   - *Mitigation*: Centralized NestJS `TenantIsolationGuard` strictly enforcing `organizationId` matching on all queries. Automated test suite explicitly testing cross-tenant access attempts.
2. **Risk: Denial of Service on Public Widget Ingestion**:
   - *Mitigation*: Rate limiting via `@nestjs/throttler` (max 60 req/min per IP on public routes), body size limits (max 50KB for message JSON), and captcha hook support.
3. **Risk: WebSocket Connection Exhaustion**:
   - *Mitigation*: Socket.IO heartbeat timeouts (20s ping interval, 10s ping timeout), automatic stale client garbage collection, and horizontal scaling via Redis adapter.
