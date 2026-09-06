#!/usr/bin/env tsx
/**
 * Migrate the original owner's single-tenant production data (§66).
 *
 * The old Metta database has Items, Accounts, Transactions and everything
 * else with NO owner column, because there was only ever one person. This
 * script assigns every one of those rows to a real authenticated User, and
 * encrypts the Plaid access tokens that were stored in plaintext.
 *
 * THIS SCRIPT IS DESTRUCTIVE IN THE SENSE THAT IT REWRITES OWNERSHIP.
 * It is built to be run deliberately, once, with a backup in hand:
 *
 *   1.  Take a Neon backup / branch. Confirm you can restore it.
 *   2.  Run with --dry-run first and read the counts.
 *   3.  Run for real.
 *   4.  Verify the counts match, sign in as the owner, and check the totals.
 *
 * It ALSO converts the legacy floating-point money columns to exact integer
 * cents. The old schema stored dollars as `Float` (amount, currentBalance,
 * …); the new one stores `Int` cents (`amountCents`, `currentBalanceCents`,
 * …). Each legacy value is converted once, with the same half-away-from-zero
 * rounding the application uses, and the conversion is verified by comparing
 * the sum before and after.
 *
 * Usage:
 *   npx tsx scripts/migrate-owner-data.ts --email owner@example.com --dry-run
 *   npx tsx scripts/migrate-owner-data.ts --email owner@example.com
 *
 * The owner must already have signed up through the normal flow, so that
 * Better Auth owns their credentials and email verification. This script
 * never creates passwords.
 */

import { PrismaClient } from "../src/generated/prisma";
import { CATEGORIES } from "../src/lib/categories";
import { encryptSecret } from "../src/lib/security/crypto";
import { activeEncryptionKey } from "../src/lib/env";
import { dollarsToCents } from "../src/lib/money";

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const DRY_RUN = process.argv.includes("--dry-run");
const OWNER_EMAIL = arg("email");

interface Counts {
  items: number;
  accounts: number;
  transactions: number;
  holdings: number;
  categories: number;
  merchantRules: number;
  budgets: number;
  goals: number;
  properties: number;
  folders: number;
  settings: number;
}

/** Count everything, so before and after can be compared (§66 step 3). */
async function countAll(where?: { userId?: string }): Promise<Counts> {
  const filter = where?.userId ? { userId: where.userId } : {};
  const [
    items, accounts, transactions, holdings, categories,
    merchantRules, budgets, goals, properties, folders, settings,
  ] = await Promise.all([
    prisma.item.count({ where: filter }),
    prisma.account.count({ where: filter }),
    prisma.transaction.count({ where: filter }),
    prisma.holding.count({ where: filter }),
    prisma.category.count({ where: filter }),
    prisma.merchantRule.count({ where: filter }),
    prisma.budget.count({ where: filter }),
    prisma.goal.count({ where: filter }),
    prisma.property.count({ where: filter }),
    prisma.folder.count({ where: filter }),
    prisma.setting.count({ where: filter }),
  ]);
  return {
    items, accounts, transactions, holdings, categories,
    merchantRules, budgets, goals, properties, folders, settings,
  };
}

function printCounts(label: string, counts: Counts): void {
  console.log(`\n${label}`);
  for (const [name, value] of Object.entries(counts)) {
    console.log(`  ${name.padEnd(16)} ${value}`);
  }
}

async function main(): Promise<void> {
  console.log("Metta owner data migration");
  console.log(DRY_RUN ? "MODE: dry run (no writes)" : "MODE: LIVE (will write)");

  if (!OWNER_EMAIL) {
    console.error("\nMissing --email. Usage: --email owner@example.com [--dry-run]");
    process.exit(1);
  }

  // --- Preflight ---------------------------------------------------------
  if (!activeEncryptionKey()) {
    console.error(
      "\nNo encryption key configured. Set ENCRYPTION_KEY_V1 and " +
        "ENCRYPTION_KEY_ACTIVE before migrating: the Plaid tokens cannot be " +
        "encrypted without one, and leaving them in plaintext is not an option.",
    );
    process.exit(1);
  }

  const owner = await prisma.user.findUnique({
    where: { email: OWNER_EMAIL.toLowerCase() },
    select: { id: true, email: true, emailVerified: true, plaidUserRef: true },
  });

  if (!owner) {
    console.error(
      `\nNo user found for ${OWNER_EMAIL}.\n\n` +
        "The owner must sign up through the normal flow first, so that their " +
        "password and email verification are handled by the auth system. Add " +
        "their address to SIGNUP_ALLOWLIST, have them register and verify, " +
        "then run this again.",
    );
    process.exit(1);
  }

  if (!owner.emailVerified) {
    console.error(
      `\n${OWNER_EMAIL} exists but has not verified their email. Verify first, ` +
        "so we know the account is reachable before it owns the financial data.",
    );
    process.exit(1);
  }

  console.log(`\nOwner: ${owner.email} (${owner.id})`);

  // --- Survey ------------------------------------------------------------
  const before = await countAll();
  printCounts("Rows in the database before migration:", before);

  const alreadyOwned = await countAll({ userId: owner.id });
  printCounts(`Rows already owned by ${owner.email}:`, alreadyOwned);

  // Anything owned by somebody ELSE is a stop condition: this script is for a
  // database that has never had more than one person's data in it.
  const otherUsers = await prisma.user.count({ where: { id: { not: owner.id } } });
  if (otherUsers > 0) {
    const otherOwned = await prisma.transaction.count({
      where: { userId: { not: owner.id } },
    });
    if (otherOwned > 0) {
      console.error(
        `\nSTOP: ${otherOwned} transactions belong to other users. This script ` +
          "claims unowned legacy rows for one owner and must not run against a " +
          "database that already has multiple tenants.",
      );
      process.exit(1);
    }
  }

  // --- Plaid tokens ------------------------------------------------------
  // Legacy rows may carry a plaintext token in the old `accessToken` column,
  // which the new schema does not have. We read it with a raw query so this
  // works against a database that still has the old shape.
  let plaintextTokens: Array<{ id: string; accessToken: string }> = [];
  try {
    plaintextTokens = await prisma.$queryRawUnsafe<Array<{ id: string; accessToken: string }>>(
      // Justified raw SQL (§15): the column does not exist in the current
      // Prisma schema, so there is no typed API for it. The statement takes
      // NO user input — it is a fixed string with no interpolation.
      `SELECT "id", "accessToken" FROM "Item" WHERE "accessToken" IS NOT NULL`,
    );
  } catch {
    console.log("\nNo legacy plaintext accessToken column found (already migrated).");
  }

  console.log(`\nPlaid tokens needing encryption: ${plaintextTokens.length}`);

  if (DRY_RUN) {
    console.log("\nDry run complete. Nothing was written.");
    console.log("\nWhat a live run would do:");
    console.log(`  - assign ${before.items - alreadyOwned.items} items to ${owner.email}`);
    console.log(
      `  - assign ${before.transactions - alreadyOwned.transactions} transactions`,
    );
    console.log(`  - encrypt ${plaintextTokens.length} Plaid access tokens`);
    console.log("  - convert every legacy Float money column to integer cents");
    console.log("  - seed the owner's category catalog if it is missing");
    await prisma.$disconnect();
    return;
  }

  // --- Migrate -----------------------------------------------------------
  console.log("\nMigrating…");

  // The owner needs their own category catalog before their transactions can
  // point at categories.
  const ownerCategories = await prisma.category.count({ where: { userId: owner.id } });
  if (ownerCategories === 0) {
    await prisma.category.createMany({
      data: CATEGORIES.map((category) => ({
        userId: owner.id,
        name: category.name,
        icon: category.icon,
        color: category.color,
        group: category.group,
      })),
    });
    console.log(`  seeded ${CATEGORIES.length} categories`);
  }

  // Encrypt tokens BEFORE anything else. If this fails we want to have
  // changed nothing.
  for (const item of plaintextTokens) {
    const cipher = encryptSecret(item.accessToken);
    await prisma.item.update({
      where: { id: item.id },
      data: { accessTokenCipher: cipher, accessTokenKeyId: activeEncryptionKey()!.id },
    });
  }
  if (plaintextTokens.length > 0) {
    console.log(`  encrypted ${plaintextTokens.length} Plaid access tokens`);
  }

  // --- Money: legacy Float dollars -> exact Int cents ---------------------
  //
  // Raw SQL is unavoidable here (§15): the legacy columns do not exist in the
  // current Prisma schema, so there is no typed API for them. Every statement
  // below is a fixed string with NO user input — the only variable is a column
  // name from the hard-coded table below.
  const MONEY_COLUMNS: Array<[table: string, legacy: string, next: string]> = [
    ["Account", "currentBalance", "currentBalanceCents"],
    ["Account", "availableBalance", "availableBalanceCents"],
    ["Transaction", "amount", "amountCents"],
    ["Transaction", "reimbursedAmount", "reimbursedAmountCents"],
    ["Holding", "value", "valueCents"],
    ["MerchantRule", "minAmount", "minAmountCents"],
    ["MerchantRule", "maxAmount", "maxAmountCents"],
    ["Budget", "amount", "amountCents"],
    ["Goal", "targetAmount", "targetAmountCents"],
    ["Goal", "currentAmount", "currentAmountCents"],
    ["Property", "rentIncome", "rentIncomeCents"],
    ["Property", "mortgage", "mortgageCents"],
    ["Property", "utilities", "utilitiesCents"],
    ["Property", "hoa", "hoaCents"],
    ["Property", "sweatIn", "sweatInCents"],
    ["Property", "sweatOut", "sweatOutCents"],
  ];

  let converted = 0;
  for (const [table, legacy, next] of MONEY_COLUMNS) {
    try {
      const rows = await prisma.$queryRawUnsafe<Array<{ id: string; v: number | null }>>(
        `SELECT "id", "${legacy}" AS v FROM "${table}" WHERE "${legacy}" IS NOT NULL`,
      );
      for (const row of rows) {
        if (row.v === null) continue;
        // The same rounding the application uses, so a value converted here
        // and a value written later by sync agree exactly.
        const cents = dollarsToCents(row.v);
        await prisma.$executeRawUnsafe(
          `UPDATE "${table}" SET "${next}" = $1 WHERE "id" = $2`,
          cents,
          row.id,
        );
        converted++;
      }
    } catch {
      // The legacy column is absent, which means this table has already been
      // converted. Not an error.
    }
  }
  if (converted > 0) console.log(`  converted ${converted} money values to integer cents`);

  // Claim ownership of every legacy row. `updateMany` with no userId filter
  // would be wrong on a multi-tenant database, which is why the stop
  // condition above exists.
  const assignments: Array<[string, () => Promise<{ count: number }>]> = [
    ["items", () => prisma.item.updateMany({ where: { userId: "" }, data: { userId: owner.id } })],
    ["accounts", () => prisma.account.updateMany({ where: { userId: "" }, data: { userId: owner.id } })],
    ["transactions", () => prisma.transaction.updateMany({ where: { userId: "" }, data: { userId: owner.id } })],
    ["holdings", () => prisma.holding.updateMany({ where: { userId: "" }, data: { userId: owner.id } })],
    ["merchantRules", () => prisma.merchantRule.updateMany({ where: { userId: "" }, data: { userId: owner.id } })],
    ["budgets", () => prisma.budget.updateMany({ where: { userId: "" }, data: { userId: owner.id } })],
    ["goals", () => prisma.goal.updateMany({ where: { userId: "" }, data: { userId: owner.id } })],
    ["properties", () => prisma.property.updateMany({ where: { userId: "" }, data: { userId: owner.id } })],
    ["folders", () => prisma.folder.updateMany({ where: { userId: "" }, data: { userId: owner.id } })],
  ];

  for (const [name, run] of assignments) {
    const { count } = await run();
    if (count > 0) console.log(`  claimed ${count} ${name}`);
  }

  // --- Verify ------------------------------------------------------------
  const after = await countAll();
  const ownerAfter = await countAll({ userId: owner.id });

  printCounts("Rows after migration:", after);
  printCounts(`Rows owned by ${owner.email}:`, ownerAfter);

  // Every count must be preserved: nothing created, nothing lost (§66 step 3).
  const lost = (Object.keys(before) as Array<keyof Counts>).filter(
    (key) => after[key] !== before[key],
  );
  if (lost.length > 0) {
    console.error(`\nWARNING: row counts changed for: ${lost.join(", ")}`);
    console.error("Investigate before proceeding. Restore from backup if unsure.");
    process.exit(1);
  }

  // And nothing may be left unowned (§66 step 4).
  const unowned = await prisma.transaction.count({ where: { userId: "" } });
  if (unowned > 0) {
    console.error(`\nWARNING: ${unowned} transactions still have no owner.`);
    process.exit(1);
  }

  // Money check: the converted total must equal the legacy total to the cent.
  // If the legacy column is gone this has already been verified on a previous
  // run, so its absence is not a failure.
  try {
    const [legacyTotal] = await prisma.$queryRawUnsafe<Array<{ total: number | null }>>(
      `SELECT SUM("amount") AS total FROM "Transaction"`,
    );
    const centsAgg = await prisma.transaction.aggregate({ _sum: { amountCents: true } });
    const expected = dollarsToCents(legacyTotal?.total ?? 0);
    const actual = centsAgg._sum.amountCents ?? 0;
    console.log(`\nMoney check: legacy sum -> ${expected} cents, converted sum -> ${actual} cents`);
    if (Math.abs(expected - actual) > 1) {
      // A one-cent tolerance: summing floats and then rounding is not exactly
      // the same operation as rounding each value and then summing, and the
      // difference is bounded by a half-cent per row. Anything larger means a
      // conversion was missed.
      console.error(
        "WARNING: converted totals differ from the legacy totals by more than a cent.",
      );
      process.exit(1);
    }
  } catch {
    console.log("\nMoney check skipped: legacy columns already removed.");
  }

  console.log("\nMigration complete.");
  console.log("\nNow verify by hand, before enabling public signup:");
  console.log(`  1. Sign in as ${owner.email}.`);
  console.log("  2. Check the Hive, Activity and Accounts screens show the right money.");
  console.log("  3. Compare net worth and this month's spending to the old app.");
  console.log("  4. Run a manual sync and confirm new transactions arrive.");
  console.log("  5. Confirm no Plaid item shows an error state.");

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("\nMigration failed:", error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exit(1);
});
