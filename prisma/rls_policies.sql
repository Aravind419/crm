-- SupportOS Enterprise PostgreSQL Row-Level Security (RLS) Policy Definitions
-- Provides defense-in-depth tenant isolation across all tenant-owned entities.

-- 1. Create dedicated unprivileged application role without embedded credentials
-- Passwords must NEVER be hardcoded in SQL migrations; use scripts/provision-roles.ts with APP_ROLE_PASSWORD.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supportos_app') THEN
    CREATE ROLE supportos_app WITH LOGIN NOCREATEDB NOCREATEROLE;
  ELSE
    ALTER ROLE supportos_app WITH NOCREATEDB NOCREATEROLE;
  END IF;

  -- If connected user has superuser privileges (e.g. native CI container), explicitly enforce NOSUPERUSER NOBYPASSRLS
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = CURRENT_USER AND rolsuper = true) THEN
    EXECUTE 'ALTER ROLE supportos_app WITH NOSUPERUSER NOBYPASSRLS';
  END IF;
END
$$;

-- Grant schema and table access to supportos_app (Least Privilege: SELECT, INSERT, UPDATE, DELETE only)
GRANT USAGE ON SCHEMA public TO supportos_app;
REVOKE CREATE ON SCHEMA public FROM supportos_app;
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

-- 4. Create policies strictly binding operations to transaction setting app.current_organization_id for supportos_app
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

-- 5. Enterprise Pre-Authentication & Public Ingestion Helper Functions
-- Executed with table owner security context (SECURITY DEFINER) to safely identify tenant context
-- before establishing transaction-local RLS.

-- 5.1 auth_lookup_user_by_email
CREATE OR REPLACE FUNCTION auth_lookup_user_by_email(p_email text)
RETURNS TABLE (
  id text,
  "organizationId" text,
  email text,
  "passwordHash" text,
  "firstName" text,
  "lastName" text,
  role "UserRole",
  status "UserStatus",
  "isAvailable" boolean,
  "avatarUrl" text,
  "orgId" text,
  "orgName" text,
  "orgSlug" text,
  "orgPlan" "Plan",
  "orgStatus" "OrgStatus"
)
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE sql
AS $$
  SELECT 
    u.id,
    u."organizationId",
    u.email,
    u."passwordHash",
    u."firstName",
    u."lastName",
    u.role,
    u.status,
    u."isAvailable",
    u."avatarUrl",
    o.id AS "orgId",
    o.name AS "orgName",
    o.slug AS "orgSlug",
    o.plan AS "orgPlan",
    o.status AS "orgStatus"
  FROM "users" u
  JOIN "organizations" o ON o.id = u."organizationId"
  WHERE lower(u.email) = lower(p_email)
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION auth_lookup_user_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_user_by_email(text) TO supportos_app;

-- 5.2 auth_lookup_refresh_token
CREATE OR REPLACE FUNCTION auth_lookup_refresh_token(p_token_hash text)
RETURNS TABLE (
  id text,
  "userId" text,
  "tokenHash" text,
  "familyId" text,
  revoked boolean,
  "expiresAt" timestamp(3),
  "rotatedAt" timestamp(3),
  "organizationId" text,
  "userStatus" "UserStatus",
  email text,
  role "UserRole"
)
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE sql
AS $$
  SELECT 
    r.id,
    r."userId",
    r."tokenHash",
    r."familyId",
    r.revoked,
    r."expiresAt",
    r."rotatedAt",
    u."organizationId",
    u.status AS "userStatus",
    u.email,
    u.role
  FROM "refresh_tokens" r
  JOIN "users" u ON u.id = r."userId"
  WHERE r."tokenHash" = p_token_hash
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION auth_lookup_refresh_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_refresh_token(text) TO supportos_app;

-- 5.3 auth_lookup_user_by_invitation
CREATE OR REPLACE FUNCTION auth_lookup_user_by_invitation(p_token_hash text)
RETURNS TABLE (
  id text,
  "organizationId" text,
  email text,
  "firstName" text,
  "lastName" text,
  role "UserRole",
  status "UserStatus",
  "invitationExpiresAt" timestamp(3),
  "orgId" text,
  "orgName" text,
  "orgSlug" text,
  "orgLogoUrl" text,
  "orgBrandColor" text
)
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE sql
AS $$
  SELECT 
    u.id,
    u."organizationId",
    u.email,
    u."firstName",
    u."lastName",
    u.role,
    u.status,
    u."invitationExpiresAt",
    o.id AS "orgId",
    o.name AS "orgName",
    o.slug AS "orgSlug",
    o."logoUrl" AS "orgLogoUrl",
    o."brandColor" AS "orgBrandColor"
  FROM "users" u
  JOIN "organizations" o ON o.id = u."organizationId"
  WHERE u."invitationTokenHash" = p_token_hash
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION auth_lookup_user_by_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_user_by_invitation(text) TO supportos_app;

-- 5.4 auth_lookup_org_by_slug
CREATE OR REPLACE FUNCTION auth_lookup_org_by_slug(p_slug text)
RETURNS TABLE (
  id text,
  name text,
  slug text
)
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE sql
AS $$
  SELECT id, name, slug FROM "organizations" WHERE slug = p_slug LIMIT 1;
$$;
REVOKE ALL ON FUNCTION auth_lookup_org_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_org_by_slug(text) TO supportos_app;

-- 5.5 public_lookup_inbox
CREATE OR REPLACE FUNCTION public_lookup_inbox(p_inbox_key text)
RETURNS TABLE (
  id text,
  "organizationId" text,
  "workspaceId" text,
  name text,
  "channelType" "ChannelType",
  "widgetColor" text,
  greeting text,
  "allowedOrigins" text,
  "orgId" text,
  "orgName" text,
  "orgSlug" text
)
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE sql
AS $$
  SELECT 
    i.id,
    i."organizationId",
    i."workspaceId",
    i.name,
    i."channelType",
    i."widgetColor",
    i.greeting,
    i."allowedOrigins",
    o.id AS "orgId",
    o.name AS "orgName",
    o.slug AS "orgSlug"
  FROM "inboxes" i
  JOIN "organizations" o ON o.id = i."organizationId"
  WHERE i."inboxKey" = p_inbox_key
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public_lookup_inbox(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_lookup_inbox(text) TO supportos_app;

-- 5.6 public_lookup_visitor_session
CREATE OR REPLACE FUNCTION public_lookup_visitor_session(p_token_hash text)
RETURNS TABLE (
  id text,
  "inboxId" text,
  "customerId" text,
  "conversationId" text,
  "tokenHash" text,
  "expiresAt" timestamp(3),
  "revokedAt" timestamp(3),
  "organizationId" text
)
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE sql
AS $$
  SELECT 
    v.id,
    v."inboxId",
    v."customerId",
    v."conversationId",
    v."tokenHash",
    v."expiresAt",
    v."revokedAt",
    i."organizationId"
  FROM "visitor_sessions" v
  JOIN "inboxes" i ON i.id = v."inboxId"
  WHERE v."tokenHash" = p_token_hash
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public_lookup_visitor_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_lookup_visitor_session(text) TO supportos_app;

-- 5.7 auth_lookup_org_by_record
CREATE OR REPLACE FUNCTION auth_lookup_org_by_record(p_table text, p_id text)
RETURNS text
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql
AS $$
DECLARE
  v_org_id text;
BEGIN
  IF p_table = 'users' THEN
    SELECT "organizationId" INTO v_org_id FROM "users" WHERE id = p_id;
  ELSIF p_table = 'customers' THEN
    SELECT "organizationId" INTO v_org_id FROM "customers" WHERE id = p_id;
  ELSIF p_table = 'inboxes' THEN
    SELECT "organizationId" INTO v_org_id FROM "inboxes" WHERE id = p_id;
  ELSIF p_table = 'conversations' THEN
    SELECT "organizationId" INTO v_org_id FROM "conversations" WHERE id = p_id;
  ELSIF p_table = 'tickets' THEN
    SELECT "organizationId" INTO v_org_id FROM "tickets" WHERE id = p_id;
  ELSIF p_table = 'teams' THEN
    SELECT "organizationId" INTO v_org_id FROM "teams" WHERE id = p_id;
  ELSIF p_table = 'organizations' THEN
    SELECT id INTO v_org_id FROM "organizations" WHERE id = p_id;
  ELSIF p_table = 'visitor_sessions' THEN
    SELECT i."organizationId" INTO v_org_id FROM "visitor_sessions" v JOIN "inboxes" i ON i.id = v."inboxId" WHERE v.id = p_id;
  ELSIF p_table = 'refresh_tokens' THEN
    SELECT u."organizationId" INTO v_org_id FROM "refresh_tokens" r JOIN "users" u ON u.id = r."userId" WHERE r.id = p_id;
  ELSIF p_table = 'audit_events' THEN
    SELECT "organizationId" INTO v_org_id FROM "audit_events" WHERE id = p_id OR "entityId" = p_id LIMIT 1;
  ELSIF p_table = 'webhook_events' THEN
    SELECT "organizationId" INTO v_org_id FROM "webhook_events" WHERE id = p_id OR "eventId" = p_id LIMIT 1;
  END IF;
  RETURN v_org_id;
END;
$$;
REVOKE ALL ON FUNCTION auth_lookup_org_by_record(text, text) FROM PUBLIC;
-- Hardening (Phase 1.5.1): Revoke execute from supportos_app to prevent record-probing or cross-tenant enumeration oracle.
-- Only administrative migration role retains access if needed for offline tools.
REVOKE ALL ON FUNCTION auth_lookup_org_by_record(text, text) FROM supportos_app;
