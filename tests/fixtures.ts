import { randomBytes } from "node:crypto";
import { PrismaClient } from "../src/generated/prisma";
import { CATEGORIES } from "../src/lib/categories";
import { encryptSecret } from "../src/lib/security/crypto";

/**
 * Two complete tenants, A and B, with the same shape of data.
 *
 * The fixtures deliberately give both users a transaction at the same
 * merchant, a folder with the same name, and a budget on the same category.
 * If tenancy were broken by a name collision rather than an id collision —
 * which is exactly what the old global `Folder.name @unique` and the shared
 * Category table would have caused — these fixtures would fail to build.
 */

export const prisma = new PrismaClient();

export interface TestUser {
  id: string;
  email: string;
  name: string;
  timezone: string;
  emailVerified: boolean;
  role: "USER" | "ADMIN";
  plaidUserRef: string;
  aiDailyLimit: number | null;
  onboardedAt: Date | null;
  termsAcceptedAt: Date | null;
  bankConsentAt: Date | null;

  // Ids of this user's rows, for the attack tests to aim at.
  itemId: string;
  accountId: string;
  transactionId: string;
  categoryId: string;
  budgetId: string;
  goalId: string;
  folderId: string;
  propertyId: string;
  holdingId: string;
  merchantRuleId: string;
}

/** Wipe every table. Order respects foreign keys. */
export async function resetDatabase(): Promise<void> {
  await prisma.transaction.deleteMany();
  await prisma.holding.deleteMany();
  await prisma.account.deleteMany();
  await prisma.item.deleteMany();
  await prisma.budget.deleteMany();
  await prisma.merchantRule.deleteMany();
  await prisma.folder.deleteMany();
  await prisma.category.deleteMany();
  await prisma.goal.deleteMany();
  await prisma.property.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.session.deleteMany();
  await prisma.authAccount.deleteMany();
  await prisma.verification.deleteMany();
  await prisma.user.deleteMany();
  await prisma.rateLimitCounter.deleteMany();
  await prisma.webhookDelivery.deleteMany();
}

/**
 * Build one complete tenant.
 *
 * `label` distinguishes the users; everything else is deliberately identical
 * between them so that any leak shows up as data that looks plausible rather
 * than obviously foreign.
 */
export async function createTenant(label: string, options?: { role?: "USER" | "ADMIN" }): Promise<TestUser> {
  const id = `u_test_${label}`;
  const email = `${label}@example.test`;

  const user = await prisma.user.create({
    data: {
      id,
      email,
      name: `User ${label.toUpperCase()}`,
      emailVerified: true,
      role: options?.role ?? "USER",
      timezone: "America/Los_Angeles",
      plaidUserRef: `mu_test_${label}_${randomBytes(4).toString("hex")}`,
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
      onboardedAt: new Date(),
    },
  });

  // Each user gets their own copy of the catalog, as provisioning does.
  await prisma.category.createMany({
    data: CATEGORIES.map((category) => ({
      userId: id,
      name: category.name,
      icon: category.icon,
      color: category.color,
      group: category.group,
    })),
  });
  const category = await prisma.category.findFirstOrThrow({
    where: { userId: id, name: "Groceries" },
  });

  const item = await prisma.item.create({
    data: {
      userId: id,
      plaidItemId: `plaid-item-${label}`,
      institutionName: "Test Bank",
      institutionId: "ins_test",
      // A real encrypted value, so decryption paths are genuinely exercised.
      accessTokenCipher: encryptSecret(`access-sandbox-${label}-secret-token`),
      accessTokenKeyId: "v1",
      status: "connected",
    },
  });

  const account = await prisma.account.create({
    data: {
      userId: id,
      itemId: item.id,
      plaidAccountId: `plaid-account-${label}`,
      name: "Checking",
      mask: "1234",
      type: "depository",
      subtype: "checking",
      currentBalance: 2500,
      availableBalance: 2500,
    },
  });

  const transaction = await prisma.transaction.create({
    data: {
      userId: id,
      accountId: account.id,
      plaidTransactionId: `plaid-txn-${label}`,
      // Same merchant for both tenants: a leak would look like normal data.
      name: "WHOLE FOODS MARKET",
      merchantName: "Whole Foods",
      amount: 84.21,
      date: new Date(),
      categoryId: category.id,
    },
  });

  const budget = await prisma.budget.create({
    data: { userId: id, categoryId: category.id, amount: 600 },
  });

  const goal = await prisma.goal.create({
    data: { userId: id, name: "Emergency Fund", targetAmount: 10000, currentAmount: 2500 },
  });

  // Same folder name for both tenants — impossible under the old global
  // unique constraint, which is the point.
  const folder = await prisma.folder.create({
    data: { userId: id, name: "Taxes 2026" },
  });

  const property = await prisma.property.create({
    data: { userId: id, name: "Elm St duplex", rentIncome: 2200, mortgage: 1400 },
  });

  const holding = await prisma.holding.create({
    data: {
      userId: id,
      accountId: account.id,
      symbol: "VOO",
      name: "Vanguard S&P 500",
      quantity: 10,
      price: 500,
      value: 5000,
    },
  });

  const merchantRule = await prisma.merchantRule.create({
    data: { userId: id, match: "whole foods", categoryId: category.id, source: "learned" },
  });

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    timezone: user.timezone,
    emailVerified: user.emailVerified,
    role: (user.role === "ADMIN" ? "ADMIN" : "USER"),
    plaidUserRef: user.plaidUserRef,
    aiDailyLimit: user.aiDailyLimit,
    onboardedAt: user.onboardedAt,
    termsAcceptedAt: user.termsAcceptedAt,
    bankConsentAt: user.bankConsentAt,
    itemId: item.id,
    accountId: account.id,
    transactionId: transaction.id,
    categoryId: category.id,
    budgetId: budget.id,
    goalId: goal.id,
    folderId: folder.id,
    propertyId: property.id,
    holdingId: holding.id,
    merchantRuleId: merchantRule.id,
  };
}

/** The AuthedUser shape the security helpers expect. */
export function asAuthedUser(user: TestUser) {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    name: user.name,
    role: user.role,
    timezone: user.timezone,
    plaidUserRef: user.plaidUserRef,
    onboardedAt: user.onboardedAt,
    termsAcceptedAt: user.termsAcceptedAt,
    bankConsentAt: user.bankConsentAt,
    aiDailyLimit: user.aiDailyLimit,
  };
}
