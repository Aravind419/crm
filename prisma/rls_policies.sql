-- SupportOS Enterprise PostgreSQL Row-Level Security (RLS) Policy Definitions
-- Provides defense-in-depth isolation at the database layer.

-- 1. Create dedicated non-superuser application role for unprivileged tenant operations
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supportos_app') THEN
    CREATE ROLE supportos_app WITH LOGIN PASSWORD 'supportos_app_password_2026' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

-- Grant schema and table access to supportos_app
GRANT USAGE ON SCHEMA public TO supportos_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO supportos_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO supportos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO supportos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO supportos_app;

-- 2. Enable RLS on core tenant-owned entities
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inboxes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;

-- 3. Force RLS for all table owners and application roles
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tickets" FORCE ROW LEVEL SECURITY;
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;
ALTER TABLE "inboxes" FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;

-- 4. Drop existing policies if any
DROP POLICY IF EXISTS tenant_isolation_conversations ON "conversations";
DROP POLICY IF EXISTS tenant_isolation_messages ON "messages";
DROP POLICY IF EXISTS tenant_isolation_tickets ON "tickets";
DROP POLICY IF EXISTS tenant_isolation_customers ON "customers";
DROP POLICY IF EXISTS tenant_isolation_inboxes ON "inboxes";
DROP POLICY IF EXISTS tenant_isolation_audit_events ON "audit_events";

-- 5. Create policies strictly binding operations to session setting app.current_organization_id
CREATE POLICY tenant_isolation_conversations ON "conversations"
  FOR ALL
  USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''));

CREATE POLICY tenant_isolation_messages ON "messages"
  FOR ALL
  USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''));

CREATE POLICY tenant_isolation_tickets ON "tickets"
  FOR ALL
  USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''));

CREATE POLICY tenant_isolation_customers ON "customers"
  FOR ALL
  USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''));

CREATE POLICY tenant_isolation_inboxes ON "inboxes"
  FOR ALL
  USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''));

CREATE POLICY tenant_isolation_audit_events ON "audit_events"
  FOR ALL
  USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''));
