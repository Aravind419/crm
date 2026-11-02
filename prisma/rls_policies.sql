-- SupportOS Enterprise PostgreSQL Row-Level Security (RLS) Policy Definitions
-- Provides defense-in-depth tenant isolation across all tenant-owned entities.

-- 1. Create dedicated application role with login and no superuser / no bypassrls privileges
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supportos_app') THEN
    CREATE ROLE supportos_app WITH LOGIN PASSWORD 'supportos_app_password_2026' NOSUPERUSER NOBYPASSRLS;
  ELSE
    ALTER ROLE supportos_app WITH LOGIN PASSWORD 'supportos_app_password_2026' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

-- Grant schema and table access to supportos_app (Least Privilege: SELECT, INSERT, UPDATE, DELETE only)
GRANT USAGE ON SCHEMA public TO supportos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO supportos_app;
REVOKE ALL PRIVILEGES ON TABLE "_prisma_migrations" FROM supportos_app;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM supportos_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO supportos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO supportos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO supportos_app;

-- 2. Enable & Force Row Level Security on all tenant-owned entities
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "team_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inboxes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ticket_comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "articles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automation_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visitor_sessions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "workspaces" FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "teams" FORCE ROW LEVEL SECURITY;
ALTER TABLE "team_members" FORCE ROW LEVEL SECURITY;
ALTER TABLE "inboxes" FORCE ROW LEVEL SECURITY;
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;
ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tickets" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ticket_comments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;
ALTER TABLE "articles" FORCE ROW LEVEL SECURITY;
ALTER TABLE "automation_rules" FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" FORCE ROW LEVEL SECURITY;
ALTER TABLE "webhook_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "visitor_sessions" FORCE ROW LEVEL SECURITY;

-- 3. Drop existing policies if any
DROP POLICY IF EXISTS tenant_isolation_organizations ON "organizations";
DROP POLICY IF EXISTS tenant_isolation_workspaces ON "workspaces";
DROP POLICY IF EXISTS tenant_isolation_users ON "users";
DROP POLICY IF EXISTS tenant_isolation_teams ON "teams";
DROP POLICY IF EXISTS tenant_isolation_team_members ON "team_members";
DROP POLICY IF EXISTS tenant_isolation_inboxes ON "inboxes";
DROP POLICY IF EXISTS tenant_isolation_customers ON "customers";
DROP POLICY IF EXISTS tenant_isolation_conversations ON "conversations";
DROP POLICY IF EXISTS tenant_isolation_messages ON "messages";
DROP POLICY IF EXISTS tenant_isolation_attachments ON "attachments";
DROP POLICY IF EXISTS tenant_isolation_tickets ON "tickets";
DROP POLICY IF EXISTS tenant_isolation_ticket_comments ON "ticket_comments";
DROP POLICY IF EXISTS tenant_isolation_categories ON "categories";
DROP POLICY IF EXISTS tenant_isolation_articles ON "articles";
DROP POLICY IF EXISTS tenant_isolation_automation_rules ON "automation_rules";
DROP POLICY IF EXISTS tenant_isolation_audit_events ON "audit_events";
DROP POLICY IF EXISTS tenant_isolation_refresh_tokens ON "refresh_tokens";
DROP POLICY IF EXISTS tenant_isolation_webhook_events ON "webhook_events";
DROP POLICY IF EXISTS tenant_isolation_visitor_sessions ON "visitor_sessions";

-- 4. Create policies strictly binding operations to session setting app.current_organization_id for supportos_app
CREATE POLICY tenant_isolation_organizations ON "organizations"
  FOR ALL
  TO supportos_app
  USING ("id" = NULLIF(current_setting('app.current_organization_id', true), ''))
  WITH CHECK ("id" = NULLIF(current_setting('app.current_organization_id', true), ''));

CREATE POLICY tenant_isolation_workspaces ON "workspaces"
  FOR ALL
  TO supportos_app
  USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''));

CREATE POLICY tenant_isolation_users ON "users"
  FOR ALL
  TO supportos_app
  USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''));

CREATE POLICY tenant_isolation_teams ON "teams"
  FOR ALL
  TO supportos_app
  USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''));

CREATE POLICY tenant_isolation_team_members ON "team_members"
  FOR ALL
  TO supportos_app
  USING ("teamId" IN (SELECT id FROM "teams" WHERE "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')))
  WITH CHECK ("teamId" IN (SELECT id FROM "teams" WHERE "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')));

CREATE POLICY tenant_isolation_inboxes ON "inboxes"
  FOR ALL
  TO supportos_app
  USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''));

CREATE POLICY tenant_isolation_customers ON "customers"
  FOR ALL
  TO supportos_app
  USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''));

CREATE POLICY tenant_isolation_conversations ON "conversations"
  FOR ALL
  TO supportos_app
  USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''));

CREATE POLICY tenant_isolation_messages ON "messages"
  FOR ALL
  TO supportos_app
  USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''));

CREATE POLICY tenant_isolation_attachments ON "attachments"
  FOR ALL
  TO supportos_app
  USING ("messageId" IN (SELECT id FROM "messages" WHERE "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')))
  WITH CHECK ("messageId" IN (SELECT id FROM "messages" WHERE "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')));

CREATE POLICY tenant_isolation_tickets ON "tickets"
  FOR ALL
  TO supportos_app
  USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''));

CREATE POLICY tenant_isolation_ticket_comments ON "ticket_comments"
  FOR ALL
  TO supportos_app
  USING ("ticketId" IN (SELECT id FROM "tickets" WHERE "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')))
  WITH CHECK ("ticketId" IN (SELECT id FROM "tickets" WHERE "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')));

CREATE POLICY tenant_isolation_categories ON "categories"
  FOR ALL
  TO supportos_app
  USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''));

CREATE POLICY tenant_isolation_articles ON "articles"
  FOR ALL
  TO supportos_app
  USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''));

CREATE POLICY tenant_isolation_automation_rules ON "automation_rules"
  FOR ALL
  TO supportos_app
  USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''));

CREATE POLICY tenant_isolation_audit_events ON "audit_events"
  FOR ALL
  TO supportos_app
  USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''));

CREATE POLICY tenant_isolation_refresh_tokens ON "refresh_tokens"
  FOR ALL
  TO supportos_app
  USING ("userId" IN (SELECT id FROM "users" WHERE "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')))
  WITH CHECK ("userId" IN (SELECT id FROM "users" WHERE "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')));

CREATE POLICY tenant_isolation_webhook_events ON "webhook_events"
  FOR ALL
  TO supportos_app
  USING ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''))
  WITH CHECK ("organizationId" = NULLIF(current_setting('app.current_organization_id', true), ''));

CREATE POLICY tenant_isolation_visitor_sessions ON "visitor_sessions"
  FOR ALL
  TO supportos_app
  USING ("inboxId" IN (SELECT id FROM "inboxes" WHERE "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')))
  WITH CHECK ("inboxId" IN (SELECT id FROM "inboxes" WHERE "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')));
