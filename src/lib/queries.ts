import "server-only";
import { prisma } from "@/lib/prisma";
import {
  sumCentsBy,
  effectiveSpendCents,
  asCents,
} from "@/lib/money";
import { monthRangeInZone, currentMonthRange as zonedCurrentMonth, partsInZone } from "@/lib/time";

/**
 * Financial aggregation queries — every one scoped to a single tenant, and
 * every figure in exact integer cents (§2, §49, §50).
 *
 * Everything returned by this module is `*Cents`. The conversion to dollars
 * happens once, at the HTTP boundary, in the route handlers. Nothing here
 * touches a float.
 *
 * Queries are also bounded: a month at a time, capped at MAX_ROWS, so no
 * single request can pull an unbounded number of rows into memory (§51).
 */

/** Account types treated as liabilities for net-worth math. */
const LIABILITY_TYPES = new Set(["credit", "loan"]);

/**
 * Personal scope: business accounts get their own breakdown screen and stay
 * out of personal budgets, cashflow and the hive.
 */
export const PERSONAL = { account: { isBusiness: false } } as const;

/** A hard ceiling on rows any single aggregation will read (§51). */
const MAX_ROWS = 5000;

export interface NetWorth {
  assetsCents: number;
  liabilitiesCents: number;
  netWorthCents: number;
  trueAvailableCents: number;
  cashCents: number;
  cardDebtCents: number;
}

export async function getNetWorth(userId: string): Promise<NetWorth> {
  const accounts = await prisma.account.findMany({
    where: { userId },
    select: { type: true, currentBalanceCents: true, availableBalanceCents: true },
  });

  let assetsCents = 0;
  let liabilitiesCents = 0;
  // "True available": spendable cash minus card balances not yet paid — the
  // number that is not inflated by an un-hit statement.
  let cashCents = 0;
  let cardDebtCents = 0;

  for (const account of accounts) {
    const balance = asCents(account.currentBalanceCents);
    if (LIABILITY_TYPES.has(account.type)) liabilitiesCents += balance;
    else assetsCents += balance;

    if (account.type === "depository") {
      cashCents += asCents(account.availableBalanceCents ?? account.currentBalanceCents);
    }
    if (account.type === "credit") cardDebtCents += balance;
  }

  return {
    assetsCents,
    liabilitiesCents,
    netWorthCents: assetsCents - liabilitiesCents,
    trueAvailableCents: cashCents - cardDebtCents,
    cashCents,
    cardDebtCents,
  };
}

export interface Cashflow {
  spendingCents: number;
  incomeCents: number;
  netCents: number;
}

/** Spending and income for a range, for one user. */
export async function getCashflow(
  userId: string,
  start: Date,
  end: Date,
): Promise<Cashflow> {
  const transactions = await prisma.transaction.findMany({
    where: { userId, date: { gte: start, lt: end }, ...PERSONAL },
    select: {
      amountCents: true,
      owedBack: true,
      reimbursedAmountCents: true,
      category: { select: { group: true } },
    },
    take: MAX_ROWS,
  });

  let spendingCents = 0;
  let incomeCents = 0;

  for (const transaction of transactions) {
    const group = transaction.category?.group ?? "expense";
    // asCents() at the read, once: amountCents arrives from a BIGINT column.
    const amountCents = asCents(transaction.amountCents);
    if (group === "expense" && amountCents > 0) {
      // A reimbursed purchase counts only for what it actually cost.
      spendingCents += transaction.owedBack
        ? effectiveSpendCents(amountCents, transaction.reimbursedAmountCents)
        : amountCents;
    }
    if (group === "income" && amountCents < 0) {
      incomeCents += -amountCents;
    }
  }

  return { spendingCents, incomeCents, netCents: incomeCents - spendingCents };
}

export interface CategorySpend {
  categoryId: string;
  name: string;
  color: string;
  icon: string;
  totalCents: number;
}

/** Spending grouped by category for a range (expense group, money out). */
export async function getSpendingByCategory(
  userId: string,
  start: Date,
  end: Date,
): Promise<CategorySpend[]> {
  const transactions = await prisma.transaction.findMany({
    where: { userId, date: { gte: start, lt: end }, amountCents: { gt: 0 }, ...PERSONAL },
    select: {
      amountCents: true,
      owedBack: true,
      reimbursedAmountCents: true,
      category: { select: { id: true, name: true, color: true, icon: true, group: true } },
    },
    take: MAX_ROWS,
  });

  const totals = new Map<string, { meta: Omit<CategorySpend, "totalCents">; cents: number }>();

  for (const transaction of transactions) {
    const category = transaction.category;
    if (!category || category.group !== "expense") continue;

    const spentCents = transaction.owedBack
      ? effectiveSpendCents(transaction.amountCents, transaction.reimbursedAmountCents)
      : asCents(transaction.amountCents);
    if (spentCents <= 0) continue;

    const existing = totals.get(category.id);
    if (existing) {
      existing.cents += spentCents;
    } else {
      totals.set(category.id, {
        meta: {
          categoryId: category.id,
          name: category.name,
          color: category.color,
          icon: category.icon,
        },
        cents: spentCents,
      });
    }
  }

  return Array.from(totals.values())
    .map(({ meta, cents }) => ({ ...meta, totalCents: cents }))
    .sort((a, b) => b.totalCents - a.totalCents);
}

/**
 * Income vs expense per month for the last N months, oldest first.
 * Months are the user's calendar months (§50).
 */
export async function getMonthlyTrend(userId: string, timeZone: string, months: number) {
  const now = new Date();
  const { year, month } = partsInZone(now, timeZone);
  const out: {
    month: string;
    label: string;
    incomeCents: number;
    spendingCents: number;
  }[] = [];

  for (let back = months - 1; back >= 0; back--) {
    let targetYear = year;
    let targetMonth = month - back;
    while (targetMonth <= 0) {
      targetMonth += 12;
      targetYear -= 1;
    }

    const { start, end } = monthRangeInZone(timeZone, targetYear, targetMonth);
    const { spendingCents, incomeCents } = await getCashflow(userId, start, end);

    out.push({
      month: `${targetYear}-${String(targetMonth).padStart(2, "0")}`,
      label: new Date(Date.UTC(targetYear, targetMonth - 1, 1)).toLocaleDateString("en-US", {
        month: "short",
        timeZone: "UTC",
      }),
      incomeCents,
      spendingCents,
    });
  }
  return out;
}

/** Budgets with this month's spend against each. */
export async function getBudgetsWithSpend(userId: string, timeZone: string) {
  const { start, end } = zonedCurrentMonth(timeZone);
  const [budgets, spendByCategory] = await Promise.all([
    prisma.budget.findMany({
      where: { userId },
      select: {
        id: true,
        categoryId: true,
        amountCents: true,
        category: {
          select: { id: true, name: true, icon: true, color: true, group: true, inBudget: true },
        },
      },
    }),
    getSpendingByCategory(userId, start, end),
  ]);

  const spentByCategory = new Map(spendByCategory.map((s) => [s.categoryId, s.totalCents]));

  return budgets
    .map((budget) => ({
      id: budget.id,
      categoryId: budget.categoryId,
      category: budget.category,
      limitCents: asCents(budget.amountCents),
      spentCents: spentByCategory.get(budget.categoryId) ?? 0,
    }))
    // Guard the divide: a zero limit would otherwise sort as NaN/Infinity.
    .sort((a, b) => {
      const ratioA =
        a.limitCents > 0 ? a.spentCents / a.limitCents : a.spentCents > 0 ? Infinity : 0;
      const ratioB =
        b.limitCents > 0 ? b.spentCents / b.limitCents : b.spentCents > 0 ? Infinity : 0;
      return ratioB - ratioA;
    });
}

/** P2P sources that usually mean someone paid you back. */
const REPAYMENT_SOURCES = [
  "cash app", "venmo", "zelle", "apple pay", "paypal", "payment from", "transfer from",
];

/** Outstanding "owed back" purchases plus likely repayments that just landed. */
export async function getReimbursements(userId: string) {
  const owed = await prisma.transaction.findMany({
    where: { userId, owedBack: true },
    select: {
      id: true,
      name: true,
      merchantName: true,
      date: true,
      amountCents: true,
      reimbursedAmountCents: true,
      category: { select: { id: true, name: true, icon: true, color: true } },
    },
    orderBy: { date: "desc" },
    take: 500,
  });

  const items = owed.map((transaction) => ({
    id: transaction.id,
    name: transaction.merchantName || transaction.name,
    date: transaction.date,
    amountCents: transaction.amountCents,
    reimbursedCents: transaction.reimbursedAmountCents,
    outstandingCents: effectiveSpendCents(
      transaction.amountCents,
      transaction.reimbursedAmountCents,
    ),
    category: transaction.category,
  }));

  const totalOwedCents = sumCentsBy(items, (item) => item.outstandingCents);

  const recentIncome = await prisma.transaction.findMany({
    where: { userId, amountCents: { lt: 0 } },
    select: { id: true, name: true, merchantName: true, date: true, amountCents: true },
    orderBy: { date: "desc" },
    take: 40,
  });

  const possibleRepayments = recentIncome
    .filter((transaction) => {
      const haystack = `${transaction.name} ${transaction.merchantName ?? ""}`.toLowerCase();
      return REPAYMENT_SOURCES.some((source) => haystack.includes(source));
    })
    .slice(0, 6)
    .map((transaction) => ({
      id: transaction.id,
      name: transaction.merchantName || transaction.name,
      date: transaction.date,
      amountCents: -transaction.amountCents, // shown as positive money-in
    }));

  return {
    totalOwedCents,
    items,
    outstanding: items.filter((item) => item.outstandingCents > 0),
    possibleRepayments,
  };
}
