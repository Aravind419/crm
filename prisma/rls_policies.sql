-- SupportOS Enterprise PostgreSQL Row-Level Security (RLS) Policy Definitions
-- Provides defense-in-depth isolation at the database layer.

-- 1. Enable RLS on core tenant-owned entities
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inboxes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;

-- 2. Force RLS for all table owners and application roles
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tickets" FORCE ROW LEVEL SECURITY;
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;
ALTER TABLE "inboxes" FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;

-- 3. Drop existing policies if any
DROP POLICY IF EXISTS tenant_isolation_conversations ON "conversations";
DROP POLICY IF EXISTS tenant_isolation_messages ON "messages";
DROP POLICY IF EXISTS tenant_isolation_tickets ON "tickets";
DROP POLICY IF EXISTS tenant_isolation_customers ON "customers";
DROP POLICY IF EXISTS tenant_isolation_inboxes ON "inboxes";
DROP POLICY IF EXISTS tenant_isolation_audit_events ON "audit_events";

-- 4. Create RESTRICTIVE policies strictly binding operations to session setting app.current_organization_id
CREATE POLICY tenant_isolation_conversations ON "conversations"
  AS RESTRICTIVE
  FOR ALL
  USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''));

CREATE POLICY tenant_isolation_messages ON "messages"
  AS RESTRICTIVE
  FOR ALL
  USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''));

CREATE POLICY tenant_isolation_tickets ON "tickets"
  AS RESTRICTIVE
  FOR ALL
  USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''));

CREATE POLICY tenant_isolation_customers ON "customers"
  AS RESTRICTIVE
  FOR ALL
  USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''));

CREATE POLICY tenant_isolation_inboxes ON "inboxes"
  AS RESTRICTIVE
  FOR ALL
  USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''));

CREATE POLICY tenant_isolation_audit_events ON "audit_events"
  AS RESTRICTIVE
  FOR ALL
  USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''));
