-- SupportOS Phase 1: Company Onboarding and Administration PostgreSQL Migration

-- 1. Alter organizations table
ALTER TABLE "organizations" 
  ADD COLUMN IF NOT EXISTS "logoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "brandColor" TEXT NOT NULL DEFAULT '#2563EB',
  ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS "locale" TEXT NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS "businessHours" JSONB,
  ADD COLUMN IF NOT EXISTS "allowedDomains" JSONB,
  ADD COLUMN IF NOT EXISTS "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "onboardingStep" INTEGER NOT NULL DEFAULT 1;

-- 2. Alter users table for secure invitations
ALTER TABLE "users" 
  ADD COLUMN IF NOT EXISTS "invitationTokenHash" TEXT,
  ADD COLUMN IF NOT EXISTS "invitationExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "invitedById" TEXT;

-- Create unique index on invitationTokenHash
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE tablename = 'users' AND indexname = 'users_invitationTokenHash_key'
  ) THEN
    CREATE UNIQUE INDEX "users_invitationTokenHash_key" ON "users"("invitationTokenHash");
  END IF;
END $$;

-- 3. Alter teams table for team lead support
ALTER TABLE "teams" 
  ADD COLUMN IF NOT EXISTS "leadId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teams_leadId_fkey'
  ) THEN
    ALTER TABLE "teams" 
      ADD CONSTRAINT "teams_leadId_fkey" 
      FOREIGN KEY ("leadId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 4. Alter inboxes table for approved website domains
ALTER TABLE "inboxes" 
  ADD COLUMN IF NOT EXISTS "allowedOrigins" TEXT;
