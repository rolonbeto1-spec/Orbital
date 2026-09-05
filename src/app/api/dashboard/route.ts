import { route, safeJson } from "@/lib/security/api";
import { prisma } from "@/lib/prisma";
import {
  getCashflow,
  getNetWorth,
  getBudgetsWithSpend,
  getSpendingByCategory,
} from "@/lib/queries";
import { currentMonthRange } from "@/lib/time";
import { plaidConfigured } from "@/lib/plaid";
import { subtractMoney } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One call powering the home dashboard, for the signed-in user only.
 *
 * The old version began with `await ensureDemoData()`, which seeded demo
 * transactions into an empty database. That is gone (§47): a new account with
 * no bank connected gets a real empty state, never data that looks like
 * somebody's money.
 */
export const GET = route({ auth: "user", limits: ["read"] }, async (ctx) => {
  const { id: userId, timezone } = ctx.user;
  const { start, end } = currentMonthRange(timezone);

  const [netWorth, cashflow, accounts, budgets, byCategory, recent, goals, itemCount, propertiesRaw] =
    await Promise.all([
      getNetWorth(userId),
      getCashflow(userId, start, end),
      prisma.account.findMany({
        where: { userId },
        select: {
          id: true, name: true, mask: true, type: true, subtype: true,
          currentBalance: true, availableBalance: true, isBusiness: true, currencyCode: true,
        },
        orderBy: { currentBalance: "desc" },
      }),
      getBudgetsWithSpend(userId, timezone),
      getSpendingByCategory(userId, start, end),
      prisma.transaction.findMany({
        where: { userId },
        orderBy: { date: "desc" },
        take: 6,
        select: {
          id: true, amount: true, date: true, name: true, merchantName: true,
          logoUrl: true, pending: true,
          category: { select: { id: true, name: true, icon: true, color: true, group: true } },
          account: { select: { name: true, mask: true } },
        },
      }),
      prisma.goal.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      prisma.item.count({ where: { userId } }),
      prisma.property.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    ]);

  const properties = propertiesRaw.map((property) => ({
    id: property.id,
    name: property.name,
    net: subtractMoney(
      property.rentIncome,
      property.mortgage + property.utilities + property.hoa,
    ),
  }));

  return safeJson({
    netWorth,
    cashflow,
    accounts,
    budgets: budgets.slice(0, 4),
    topCategories: byCategory.slice(0, 5),
    recent,
    goals,
    month: start.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: timezone }),
    connectedBanks: itemCount,
    plaidConfigured,
    properties,
  });
});
