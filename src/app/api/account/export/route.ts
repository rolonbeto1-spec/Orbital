import { route, safeJson } from "@/lib/security/api";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Export everything Metta holds about the signed-in user (§36).
 *
 * Two rules govern this file, and both are visible in the code below rather
 * than being promised in a comment somewhere else:
 *
 * 1. EVERY query is scoped by `userId`. There is no unscoped `findMany()`
 *    here that is later filtered in JavaScript — a bug in that filter would
 *    be a bulk cross-tenant disclosure, which is the worst thing this
 *    application could do. The scope is in the database query.
 *
 * 2. EVERY model uses an explicit `select`. Nothing is spread from a Prisma
 *    row. That is what keeps the excluded list below actually excluded:
 *    with `include`, adding a column to the schema later would silently add
 *    it to the export.
 *
 * Deliberately NOT exported:
 *   - Item.accessTokenCipher and accessTokenKeyId — the encrypted Plaid
 *     credential and the key generation that decrypts it;
 *   - AuthAccount.password — the scrypt hash;
 *   - Session.token — live session credentials;
 *   - Verification rows — password-reset and email-verification tokens are
 *     credentials while they live;
 *   - internal rate-limit and webhook bookkeeping.
 *
 * Exporting any of those would turn "download my data" into "download the
 * keys to my bank feed and my account", which is the opposite of what a data
 * export is for.
 */

/** Hard caps, so an export cannot be used to exhaust memory (§51). */
const MAX_TRANSACTIONS = 50_000;
const MAX_ROWS = 5_000;

export const GET = route(
  { auth: "user", limits: ["export"], audit: "account.export" },
  async (ctx) => {
    const userId = ctx.user.id;

    const [
      user, items, accounts, transactions, holdings,
      categories, merchantRules, budgets, goals, properties, folders, settings,
    ] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          email: true,
          name: true,
          emailVerified: true,
          timezone: true,
          createdAt: true,
          termsAcceptedAt: true,
          privacyAcceptedAt: true,
          bankConsentAt: true,
          onboardedAt: true,
          // NOT selected: role (internal), plaidUserRef (an identifier we
          // share with Plaid, not the user's data), deletedAt.
        },
      }),

      prisma.item.findMany({
        where: { userId },
        select: {
          institutionName: true,
          institutionId: true,
          status: true,
          createdAt: true,
          lastSyncedAt: true,
          // NOT selected: accessTokenCipher, accessTokenKeyId, cursor.
        },
      }),

      prisma.account.findMany({
        where: { userId },
        select: {
          name: true, officialName: true, mask: true, type: true, subtype: true,
          currentBalance: true, availableBalance: true, isBusiness: true,
          currencyCode: true, createdAt: true,
          item: { select: { institutionName: true } },
        },
        take: MAX_ROWS,
      }),

      prisma.transaction.findMany({
        where: { userId },
        select: {
          date: true, name: true, merchantName: true, amount: true,
          currencyCode: true, pending: true, notes: true,
          owedBack: true, reimbursedAmount: true,
          category: { select: { name: true } },
          folder: { select: { name: true } },
          account: { select: { name: true, mask: true } },
          // NOT selected: plaidTransactionId, logoUrl, internal ids.
        },
        orderBy: { date: "desc" },
        take: MAX_TRANSACTIONS,
      }),

      prisma.holding.findMany({
        where: { userId },
        select: {
          symbol: true, name: true, quantity: true, price: true, value: true,
          kind: true, updatedAt: true,
          account: { select: { name: true } },
        },
        take: MAX_ROWS,
      }),

      prisma.category.findMany({
        where: { userId },
        select: { name: true, group: true, inBudget: true },
      }),

      prisma.merchantRule.findMany({
        where: { userId },
        select: {
          match: true, minAmount: true, maxAmount: true, source: true, createdAt: true,
          category: { select: { name: true } },
        },
        take: MAX_ROWS,
      }),

      prisma.budget.findMany({
        where: { userId },
        select: { amount: true, createdAt: true, category: { select: { name: true } } },
      }),

      prisma.goal.findMany({
        where: { userId },
        select: {
          name: true, targetAmount: true, currentAmount: true, targetDate: true,
          createdAt: true,
        },
      }),

      prisma.property.findMany({
        where: { userId },
        select: {
          name: true, rentIncome: true, mortgage: true, utilities: true, hoa: true,
          sweatIn: true, sweatOut: true, notes: true, createdAt: true,
        },
      }),

      prisma.folder.findMany({
        where: { userId },
        select: { name: true, createdAt: true },
      }),

      // The user's own preferences: hive layout, alert prefs, dismissals.
      // The AI counters and cache keys are theirs too and are harmless.
      prisma.setting.findMany({
        where: { userId },
        select: { key: true, value: true, updatedAt: true },
        take: MAX_ROWS,
      }),
    ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      format: "metta-export-v1",
      notice:
        "This file contains your financial data. Anyone who can read it can " +
        "see your balances and transactions. Store it somewhere private.",
      excluded:
        "Bank access credentials, password hashes and session tokens are " +
        "deliberately not included; they are secrets, not your data.",
      account: user,
      connections: items,
      accounts,
      transactions,
      holdings,
      categories,
      merchantRules,
      budgets,
      goals,
      properties,
      folders,
      settings,
      counts: {
        connections: items.length,
        accounts: accounts.length,
        transactions: transactions.length,
        truncated: transactions.length >= MAX_TRANSACTIONS,
      },
    };

    await recordAudit({
      userId,
      type: "account.export_completed",
      meta: { transactions: transactions.length, accounts: accounts.length },
    });

    const response = safeJson(payload);
    response.headers.set(
      "Content-Disposition",
      `attachment; filename="metta-export-${new Date().toISOString().slice(0, 10)}.json"`,
    );
    return response;
  },
);
