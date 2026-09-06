# Migrating the original owner's database

This directory upgrades the **original single-user Metta database** to the
multi-tenant schema. It is a one-time operation against one specific database.

A brand-new deployment does not need any of this: `prisma migrate deploy`
creates the multi-tenant schema from empty and there is nothing to migrate.

## Why this is not a Prisma migration

`prisma migrate diff` generates a single migration for this change, and that
migration **destroys the data**. It emits statements like:

```sql
ALTER TABLE "Transaction" DROP COLUMN "amount",
                          ADD COLUMN "amountCents" BIGINT NOT NULL;
```

which deletes every dollar figure in the same statement that adds the column
meant to hold it, before anything converts one into the other. It also adds
`userId TEXT NOT NULL` with no default to populated tables and attaches the
foreign key immediately, so it cannot run at all on a database with rows in it.

Applying the committed `00000000000000_init` migration to the legacy database
does not work either — it is a create-from-empty migration, so Prisma stops
with `P3005: The database schema is not empty`.

The upgrade is therefore an **expand / backfill / contract** sequence, run by
hand, with the database readable and the old values still present until the
final step.

## The sequence

| Phase | What runs | Reversible? |
|---|---|---|
| 1 | `01-expand.sql` | Yes — only adds |
| 2 | `scripts/migrate-owner-data.ts` | Yes — old columns still hold the originals |
| 3 | `02-contract.sql` | **No** — drops the legacy columns and the plaintext tokens |

Phases 1 and 2 are safe to re-run. Phase 3 refuses to run if phase 2 did not
finish, and rolls back entirely if it does refuse.

## Before you start

1. **Take a backup and restore it somewhere to prove it works.** An untested
   backup is not a backup. Phase 3 is irreversible.
2. The owner must already have signed up through the normal flow and verified
   their email. This script never creates passwords; Better Auth owns
   credentials.
3. `ENCRYPTION_KEY_V1` and `ENCRYPTION_KEY_ACTIVE` must be set to the values
   production will use. The Plaid tokens are encrypted with them, and a
   different key later means the bank connections cannot be decrypted.
4. Point the Prisma client at PostgreSQL: `npm run db:postgres`.

## Running it

```bash
export DATABASE_URL="postgresql://…"          # the legacy database
export ENCRYPTION_KEY_V1=…  ENCRYPTION_KEY_ACTIVE=v1

# Phase 1 — expand. Adds columns and auth tables; changes no data.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/legacy-upgrade/01-expand.sql

# Phase 2 — backfill. Read the dry run before doing it for real.
npm run migrate:owner -- --email owner@example.com --dry-run
npm run migrate:owner -- --email owner@example.com

# Phase 3 — contract. Irreversible. Only after phase 2 reported success.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/legacy-upgrade/02-contract.sql

# Record that the schema now matches the committed migration, so future
# deploys work normally.
npx prisma migrate resolve --applied 00000000000000_init
npx prisma migrate deploy      # should report: No pending migrations to apply.
```

## Verifying

The schema should now be identical to the committed one. This must print
`This is an empty migration.`:

```bash
npx prisma migrate diff --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma --script
```

Then check the data:

```sql
-- No row may be unowned. All zeros.
SELECT (SELECT count(*) FROM "Item"        i LEFT JOIN "user" u ON u.id=i."userId" WHERE u.id IS NULL),
       (SELECT count(*) FROM "Transaction" t LEFT JOIN "user" u ON u.id=t."userId" WHERE u.id IS NULL),
       (SELECT count(*) FROM "Category"    c LEFT JOIN "user" u ON u.id=c."userId" WHERE u.id IS NULL);

-- Every Plaid item has an encrypted token and no plaintext column remains.
SELECT count(*) FROM "Item" WHERE "accessTokenCipher" IS NULL;
```

Phase 2 prints row counts before and after and compares the transaction total
before and after conversion. Read those numbers; do not assume them.

Finally, sign in as the owner and compare net worth, this month's spending, and
the account balances against the old application before enabling signup for
anyone else.

## What was found by rehearsing this

This sequence exists because the migration was rehearsed against a fixture
built from the real legacy schema. The rehearsal found that:

* the committed migration could not be applied to the legacy database at all;
* the auto-generated alternative would have dropped every money column;
* the migration script could not even start, because it imports a module
  marked `server-only`, which throws outside a server build;
* it seeded a second category catalog instead of claiming the legacy one,
  which would have left every transaction's `categoryId` pointing at a
  category owned by nobody;
* it never claimed `Category` or `Setting` rows;
* it silently dropped `Holding.price`, zeroing every holding's market price.

None of these were visible by reading the script. Rehearse against a restored
copy of the real database before running this for real.
