-- ===========================================================================
-- Legacy Metta -> multi-tenant Metta:  PHASE 1 of 3  (EXPAND)
-- ===========================================================================
--
-- Run order:
--    1. scripts/legacy-upgrade/01-expand.sql      <- this file
--    2. npx tsx scripts/migrate-owner-data.ts --email <owner>   (backfill)
--    3. scripts/legacy-upgrade/02-contract.sql
--
-- WHY THIS IS HAND-WRITTEN
--
-- `prisma migrate diff` generates a single migration for this change, and that
-- migration destroys the data. It emits, for example:
--
--     ALTER TABLE "Transaction" DROP COLUMN "amount",
--                               ADD COLUMN "amountCents" BIGINT NOT NULL;
--
-- which deletes every dollar figure in the same statement that adds the column
-- meant to hold it — before anything has had a chance to convert one into the
-- other. It also adds `userId TEXT NOT NULL` with no default to tables that
-- already have rows, and attaches the foreign key immediately, so on a
-- populated database it simply fails.
--
-- This phase therefore only ADDS. It creates the auth tables, adds the new
-- columns alongside the legacy ones, and adds nothing that the existing rows
-- could violate. The database keeps working throughout: every legacy column is
-- still present and still populated when this finishes.
--
-- Safe to re-run: every statement is IF NOT EXISTS.
-- ===========================================================================

BEGIN;

-- --- New tables (empty, so their constraints are safe immediately) ---

CREATE TABLE IF NOT EXISTS "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "plaidUserRef" TEXT NOT NULL,
    "termsAcceptedAt" TIMESTAMP(3),
    "privacyAcceptedAt" TIMESTAMP(3),
    "bankConsentAt" TIMESTAMP(3),
    "onboardedAt" TIMESTAMP(3),
    "aiDailyLimit" INTEGER,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "auth_account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "issuer" TEXT NOT NULL DEFAULT '',
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "better_auth_rate_limit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "better_auth_rate_limit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'success',
    "ip" TEXT,
    "userAgent" TEXT,
    "meta" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RateLimitCounter" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimitCounter_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "itemId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_email_key" ON "user"("email");

CREATE UNIQUE INDEX IF NOT EXISTS "user_plaidUserRef_key" ON "user"("plaidUserRef");

CREATE INDEX IF NOT EXISTS "user_deletedAt_idx" ON "user"("deletedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "session_token_key" ON "session"("token");

CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session"("userId");

CREATE INDEX IF NOT EXISTS "session_expiresAt_idx" ON "session"("expiresAt");

CREATE INDEX IF NOT EXISTS "auth_account_userId_idx" ON "auth_account"("userId");

CREATE UNIQUE INDEX IF NOT EXISTS "auth_account_providerId_accountId_key" ON "auth_account"("providerId", "accountId");

CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification"("identifier");

CREATE INDEX IF NOT EXISTS "verification_expiresAt_idx" ON "verification"("expiresAt");

CREATE UNIQUE INDEX IF NOT EXISTS "better_auth_rate_limit_key_key" ON "better_auth_rate_limit"("key");

CREATE INDEX IF NOT EXISTS "AuditEvent_userId_createdAt_idx" ON "AuditEvent"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "AuditEvent_type_createdAt_idx" ON "AuditEvent"("type", "createdAt");

CREATE INDEX IF NOT EXISTS "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

CREATE INDEX IF NOT EXISTS "RateLimitCounter_resetAt_idx" ON "RateLimitCounter"("resetAt");

CREATE UNIQUE INDEX IF NOT EXISTS "WebhookDelivery_fingerprint_key" ON "WebhookDelivery"("fingerprint");

CREATE INDEX IF NOT EXISTS "WebhookDelivery_receivedAt_idx" ON "WebhookDelivery"("receivedAt");

DO $$ BEGIN
  ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- Legacy global-unique indexes ------------------------------------------
--
-- In the single-user schema a category name and a folder name were unique
-- across the whole table, because the whole table belonged to one person.
-- Multi-tenant, the same names must be able to coexist for different people,
-- and uniqueness becomes per-user (added in phase 3).
--
-- These are dropped here rather than in phase 3 because they actively block
-- the backfill: claiming the legacy rows for the owner, or seeding a catalog,
-- collides with a table-wide unique name. Dropping an index can never violate
-- an existing row, so it is safe in the expand phase.

DROP INDEX IF EXISTS "Category_name_key";
DROP INDEX IF EXISTS "Folder_name_key";

-- --- Ownership columns -----------------------------------------------------
--
-- Added with DEFAULT '' rather than NULL, because '' is exactly what
-- scripts/migrate-owner-data.ts looks for when it claims unowned legacy rows
-- (`where: { userId: "" }`). No foreign key yet: '' is not a real user id, so
-- the constraint would fail instantly. Phase 3 adds it, once every row points
-- at the real owner.

ALTER TABLE "Item"         ADD COLUMN IF NOT EXISTS "userId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Account"      ADD COLUMN IF NOT EXISTS "userId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Transaction"  ADD COLUMN IF NOT EXISTS "userId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Holding"      ADD COLUMN IF NOT EXISTS "userId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Category"     ADD COLUMN IF NOT EXISTS "userId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "MerchantRule" ADD COLUMN IF NOT EXISTS "userId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Budget"       ADD COLUMN IF NOT EXISTS "userId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Goal"         ADD COLUMN IF NOT EXISTS "userId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Property"     ADD COLUMN IF NOT EXISTS "userId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Folder"       ADD COLUMN IF NOT EXISTS "userId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Setting"      ADD COLUMN IF NOT EXISTS "userId" TEXT NOT NULL DEFAULT '';

-- --- Money columns ---------------------------------------------------------
--
-- BIGINT, not INTEGER: on PostgreSQL `INTEGER` is 32-bit, which caps a balance
-- at $21,474,836.47 and makes a larger one fail the INSERT outright.
--
-- The legacy Float columns are deliberately left in place. Phase 2 reads them,
-- converts each value once with the application's own rounding, and writes the
-- result here; phase 3 drops them, and only after the totals have been
-- compared. Until then the old numbers remain available to compare against and
-- to roll back to.

ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "currentBalanceCents"   BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "availableBalanceCents" BIGINT;

ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "amountCents"           BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "reimbursedAmountCents" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "Holding" ADD COLUMN IF NOT EXISTS "valueCents" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Holding" ADD COLUMN IF NOT EXISTS "priceUsd"   DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Sentinel bounds, not NULL: a UNIQUE index containing a nullable column
-- constrains nothing, because no NULL equals another NULL. With NULLs here the
-- unique index added in phase 3 would silently permit duplicate rules.
ALTER TABLE "MerchantRule" ADD COLUMN IF NOT EXISTS "minAmountCents" BIGINT NOT NULL DEFAULT -9007199254740000;
ALTER TABLE "MerchantRule" ADD COLUMN IF NOT EXISTS "maxAmountCents" BIGINT NOT NULL DEFAULT  9007199254740000;

ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "amountCents" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "Goal" ADD COLUMN IF NOT EXISTS "targetAmountCents"  BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Goal" ADD COLUMN IF NOT EXISTS "currentAmountCents" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "rentIncomeCents" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "mortgageCents"   BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "utilitiesCents"  BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "hoaCents"        BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "sweatInCents"    BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "sweatOutCents"   BIGINT NOT NULL DEFAULT 0;

-- --- Plaid token encryption ------------------------------------------------
--
-- Nullable for now. The legacy plaintext "accessToken" column stays until
-- phase 3, because phase 2 reads it to produce the ciphertext. Phase 3 drops
-- it — that drop is the point at which the plaintext tokens stop existing.

ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "accessTokenCipher" TEXT;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "accessTokenKeyId"  TEXT;

-- --- Other new Item/Setting columns ---------------------------------------

ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "status"         TEXT NOT NULL DEFAULT 'connected';
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "statusDetail"   TEXT;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "lastSyncedAt"   TIMESTAMP(3);
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "lastSyncError"  TEXT;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "syncStartedAt"  TIMESTAMP(3);
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "logoBackfillAt" TIMESTAMP(3);

ALTER TABLE "Setting" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- --- Non-unique indexes ----------------------------------------------------
-- Safe now: an index no row can violate. The UNIQUE ones wait for phase 3,
-- because every legacy row currently shares the same userId ('').

CREATE INDEX IF NOT EXISTS "Item_userId_idx"                  ON "Item"("userId");
CREATE INDEX IF NOT EXISTS "Item_userId_status_idx"           ON "Item"("userId", "status");
CREATE INDEX IF NOT EXISTS "Account_userId_idx"               ON "Account"("userId");
CREATE INDEX IF NOT EXISTS "Account_userId_isBusiness_idx"    ON "Account"("userId", "isBusiness");
CREATE INDEX IF NOT EXISTS "Transaction_userId_idx"           ON "Transaction"("userId");
CREATE INDEX IF NOT EXISTS "Transaction_userId_date_idx"      ON "Transaction"("userId", "date");
CREATE INDEX IF NOT EXISTS "Transaction_userId_categoryId_idx" ON "Transaction"("userId", "categoryId");
CREATE INDEX IF NOT EXISTS "Transaction_userId_accountId_idx" ON "Transaction"("userId", "accountId");
CREATE INDEX IF NOT EXISTS "Transaction_userId_folderId_idx"  ON "Transaction"("userId", "folderId");
CREATE INDEX IF NOT EXISTS "Transaction_userId_pending_idx"   ON "Transaction"("userId", "pending");
CREATE INDEX IF NOT EXISTS "Holding_userId_idx"               ON "Holding"("userId");
CREATE INDEX IF NOT EXISTS "Category_userId_idx"              ON "Category"("userId");
CREATE INDEX IF NOT EXISTS "MerchantRule_userId_match_idx"    ON "MerchantRule"("userId", "match");
CREATE INDEX IF NOT EXISTS "Budget_userId_idx"                ON "Budget"("userId");
CREATE INDEX IF NOT EXISTS "Goal_userId_idx"                  ON "Goal"("userId");
CREATE INDEX IF NOT EXISTS "Property_userId_idx"              ON "Property"("userId");
CREATE INDEX IF NOT EXISTS "Folder_userId_idx"                ON "Folder"("userId");
CREATE INDEX IF NOT EXISTS "Setting_userId_idx"               ON "Setting"("userId");

COMMIT;
