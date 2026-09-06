-- ===========================================================================
-- Legacy Metta -> multi-tenant Metta:  PHASE 3 of 3  (CONTRACT)
-- ===========================================================================
--
-- Run order:
--    1. scripts/legacy-upgrade/01-expand.sql
--    2. npx tsx scripts/migrate-owner-data.ts --email <owner>   (backfill)
--    3. scripts/legacy-upgrade/02-contract.sql    <- this file
--
-- DO NOT RUN THIS UNTIL PHASE 2 HAS SUCCEEDED AND YOU HAVE CHECKED ITS OUTPUT.
--
-- This is the irreversible phase. It drops the legacy dollar columns and the
-- plaintext Plaid access tokens, and it adds the constraints that make the
-- tenancy rule structural rather than a convention: after this runs, a row
-- with no owner cannot exist, because the foreign key will not allow it.
--
-- Everything here fails loudly rather than silently if the backfill was
-- incomplete — an unowned row makes the foreign key fail and the whole
-- transaction roll back, which is the desired outcome.
-- ===========================================================================

BEGIN;

-- --- Refuse to run against an incomplete backfill --------------------------
--
-- Cheaper to stop here with a clear message than to have a foreign key fail
-- halfway through with a constraint name and no explanation.
DO $$
DECLARE unowned BIGINT;
BEGIN
  SELECT
      (SELECT count(*) FROM "Item"         WHERE "userId" = '')
    + (SELECT count(*) FROM "Account"      WHERE "userId" = '')
    + (SELECT count(*) FROM "Transaction"  WHERE "userId" = '')
    + (SELECT count(*) FROM "Holding"      WHERE "userId" = '')
    + (SELECT count(*) FROM "Category"     WHERE "userId" = '')
    + (SELECT count(*) FROM "MerchantRule" WHERE "userId" = '')
    + (SELECT count(*) FROM "Budget"       WHERE "userId" = '')
    + (SELECT count(*) FROM "Goal"         WHERE "userId" = '')
    + (SELECT count(*) FROM "Property"     WHERE "userId" = '')
    + (SELECT count(*) FROM "Folder"       WHERE "userId" = '')
    + (SELECT count(*) FROM "Setting"      WHERE "userId" = '')
  INTO unowned;
  IF unowned > 0 THEN
    RAISE EXCEPTION
      'Refusing to contract: % rows still have no owner. Run scripts/migrate-owner-data.ts first.', unowned;
  END IF;
END $$;

-- Same for the Plaid tokens: contracting would drop the plaintext column, and
-- an Item whose ciphertext was never written would lose its bank connection
-- permanently, with no way to recover it short of re-linking the bank.
DO $$
DECLARE missing BIGINT;
BEGIN
  SELECT count(*) INTO missing FROM "Item"
   WHERE "accessTokenCipher" IS NULL OR "accessTokenKeyId" IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION
      'Refusing to contract: % Plaid items have no encrypted token. Dropping the plaintext column now would lose the bank connection.', missing;
  END IF;
END $$;

-- --- Enforce ownership -----------------------------------------------------
--
-- The default was scaffolding for the backfill; a new row must now name a real
-- owner rather than inheriting ''.

ALTER TABLE "Item"         ALTER COLUMN "userId" DROP DEFAULT;
ALTER TABLE "Account"      ALTER COLUMN "userId" DROP DEFAULT;
ALTER TABLE "Transaction"  ALTER COLUMN "userId" DROP DEFAULT;
ALTER TABLE "Holding"      ALTER COLUMN "userId" DROP DEFAULT;
ALTER TABLE "Category"     ALTER COLUMN "userId" DROP DEFAULT;
ALTER TABLE "MerchantRule" ALTER COLUMN "userId" DROP DEFAULT;
ALTER TABLE "Budget"       ALTER COLUMN "userId" DROP DEFAULT;
ALTER TABLE "Goal"         ALTER COLUMN "userId" DROP DEFAULT;
ALTER TABLE "Property"     ALTER COLUMN "userId" DROP DEFAULT;
ALTER TABLE "Folder"       ALTER COLUMN "userId" DROP DEFAULT;
ALTER TABLE "Setting"      ALTER COLUMN "userId" DROP DEFAULT;

ALTER TABLE "Item"         ADD CONSTRAINT "Item_userId_fkey"         FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Account"      ADD CONSTRAINT "Account_userId_fkey"      FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Transaction"  ADD CONSTRAINT "Transaction_userId_fkey"  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Holding"      ADD CONSTRAINT "Holding_userId_fkey"      FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Category"     ADD CONSTRAINT "Category_userId_fkey"     FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MerchantRule" ADD CONSTRAINT "MerchantRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Budget"       ADD CONSTRAINT "Budget_userId_fkey"       FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Goal"         ADD CONSTRAINT "Goal_userId_fkey"         FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Property"     ADD CONSTRAINT "Property_userId_fkey"     FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Folder"       ADD CONSTRAINT "Folder_userId_fkey"       FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Setting"      ADD CONSTRAINT "Setting_userId_fkey"      FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --- Plaid tokens are encrypted from here on -------------------------------

ALTER TABLE "Item" ALTER COLUMN "accessTokenCipher" SET NOT NULL;
ALTER TABLE "Item" ALTER COLUMN "accessTokenKeyId"  SET NOT NULL;

-- --- Per-tenant uniqueness -------------------------------------------------
--
-- Two people may now both have a category called "Groceries". Uniqueness is
-- per user, and every column in these indexes is NOT NULL, without which the
-- index would not constrain anything (no NULL equals another NULL).

CREATE UNIQUE INDEX "Category_userId_name_key" ON "Category"("userId", "name");
CREATE UNIQUE INDEX "Folder_userId_name_key"   ON "Folder"("userId", "name");
CREATE UNIQUE INDEX "MerchantRule_userId_match_minAmountCents_maxAmountCents_key"
    ON "MerchantRule"("userId", "match", "minAmountCents", "maxAmountCents");

-- A setting is identified by (owner, key), not by key alone.
ALTER TABLE "Setting" DROP CONSTRAINT "Setting_pkey";
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_pkey" PRIMARY KEY ("userId", "key");

-- --- Drop the scaffolding defaults ----------------------------------------
-- These columns carry no default in the target schema; the defaults existed
-- only so the columns could be added to populated tables.

ALTER TABLE "Transaction" ALTER COLUMN "amountCents"       DROP DEFAULT;
ALTER TABLE "Budget"      ALTER COLUMN "amountCents"       DROP DEFAULT;
ALTER TABLE "Goal"        ALTER COLUMN "targetAmountCents" DROP DEFAULT;
ALTER TABLE "Holding"     ALTER COLUMN "valueCents"        DROP DEFAULT;
ALTER TABLE "Holding"     ALTER COLUMN "priceUsd"          DROP DEFAULT;

-- --- Legacy indexes replaced by tenant-scoped ones -------------------------

DROP INDEX IF EXISTS "Transaction_accountId_idx";
DROP INDEX IF EXISTS "Transaction_categoryId_idx";
DROP INDEX IF EXISTS "Transaction_date_idx";
DROP INDEX IF EXISTS "Transaction_folderId_idx";
DROP INDEX IF EXISTS "MerchantRule_match_idx";

-- --- The irreversible part -------------------------------------------------
--
-- The plaintext Plaid access tokens stop existing here. So do the legacy
-- floating-point dollar columns, whose values have already been converted and
-- whose totals have already been compared.

ALTER TABLE "Item"         DROP COLUMN "accessToken";

ALTER TABLE "Account"      DROP COLUMN "currentBalance", DROP COLUMN "availableBalance";
ALTER TABLE "Transaction"  DROP COLUMN "amount", DROP COLUMN "reimbursedAmount";
ALTER TABLE "Holding"      DROP COLUMN "value", DROP COLUMN "price";
ALTER TABLE "MerchantRule" DROP COLUMN "minAmount", DROP COLUMN "maxAmount";
ALTER TABLE "Budget"       DROP COLUMN "amount";
ALTER TABLE "Goal"         DROP COLUMN "targetAmount", DROP COLUMN "currentAmount";
ALTER TABLE "Property"     DROP COLUMN "rentIncome", DROP COLUMN "mortgage",
                           DROP COLUMN "utilities",  DROP COLUMN "hoa",
                           DROP COLUMN "sweatIn",    DROP COLUMN "sweatOut";

COMMIT;
