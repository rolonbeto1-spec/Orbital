import "server-only";
import { prisma } from "@/lib/prisma";
import { sumBy, effectiveSpend, subtractMoney, addMoney, roundMoney } from "@/lib/money";
import { monthRangeInZone, currentMonthRange as zonedCurrentMonth, partsInZone } from "@/lib/time";

/**
 * Financial aggregation queries — every one scoped to a single tenant.
 *
 * Three things changed from the single-user versions:
 *  1. every function takes a userId and every query filters on it (§2);
 *  2. sums go through src/lib/money.ts so thousands of additions do not
 *     accumulate float error (§49);
 *  3. periods are computed in the user's timezone, not the server's (§50).
 *
 * Queries are also bounded. `getCashflow` and friends read a month at a time
 * rather than a whole history, so no single request can pull an unbounded
 * number of rows into memory (§51).
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

export async function getNetWorth(userId: string) {
  const accounts = await prisma.account.findMany({
    where: { userId },
    select: { type: true, currentBalance: true, availableBalance: true },
  });

  let assets = 0;
  let liabilities = 0;
  // "True available": spendable cash minus card balances not yet paid — the
  // number that is not inflated by an un-hit statement.
  let cash = 0;
  let cardDebt = 0;

  for (const account of accounts) {
    if (LIABILITY_TYPES.has(account.type)) {
      liabilities = addMoney(liabilities, account.currentBalance);
    } else {
      assets = addMoney(assets, account.currentBalance);
    }
    if (account.type === "depository") {
      cash = addMoney(cash, account.availableBalance ?? account.currentBalance);
    }
    if (account.type === "credit") {
      cardDebt = addMoney(cardDebt, account.currentBalance);
    }
  }

  return {
    assets,
    liabilities,
    netWorth: subtractMoney(assets, liabilities),
    trueAvailable: subtractMoney(cash, cardDebt),
    cash,
    cardDebt,
  };
}

/** Spending and income for a range, for one user. */
export async function getCashflow(userId: string, start: Date, end: Date) {
  const transactions = await prisma.transaction.findMany({
    where: { userId, date: { gte: start, lt: end }, ...PERSONAL },
    select: {
      amount: true,
      owedBack: true,
      reimbursedAmount: true,
      category: { select: { group: true } },
    },
    take: MAX_ROWS,
  });

  let spending = 0;
  let income = 0;

  for (const transaction of transactions) {
    const group = transaction.category?.group ?? "expense";
    if (group === "expense" && transaction.amount > 0) {
      // A reimbursed purchase counts only for what it actually cost.
      const spent = transaction.owedBack
        ? effectiveSpend(transaction.amount, transaction.reimbursedAmount)
        : transaction.amount;
      spending = addMoney(spending, spent);
    }
    if (group === "income" && transaction.amount < 0) {
      income = addMoney(income, -transaction.amount);
    }
  }

  return { spending, income, net: subtractMoney(income, spending) };
}

export interface CategorySpend {
  categoryId: string;
  name: string;
  color: string;
  icon: string;
  total: number;
}

/** Spending grouped by category for a range (expense group, money out). */
export async function getSpendingByCategory(
  userId: string,
  start: Date,
  end: Date,
): Promise<CategorySpend[]> {
  const transactions = await prisma.transaction.findMany({
    where: { userId, date: { gte: start, lt: end }, amount: { gt: 0 }, ...PERSONAL },
    select: {
      amount: true,
      owedBack: true,
      reimbursedAmount: true,
      category: { select: { id: true, name: true, color: true, icon: true, group: true } },
    },
    take: MAX_ROWS,
  });

  // Accumulate in cents, convert once at the end.
  const totals = new Map<string, { meta: Omit<CategorySpend, "total">; cents: number }>();

  for (const transaction of transactions) {
    const category = transaction.category;
    if (!category || category.group !== "expense") continue;

    const spent = transaction.owedBack
      ? effectiveSpend(transaction.amount, transaction.reimbursedAmount)
      : transaction.amount;
    if (spent <= 0) continue;

    const existing = totals.get(category.id);
    if (existing) {
      existing.cents += Math.round(spent * 100);
    } else {
      totals.set(category.id, {
        meta: {
          categoryId: category.id,
          name: category.name,
          color: category.color,
          icon: category.icon,
        },
        cents: Math.round(spent * 100),
      });
    }
  }

  return Array.from(totals.values())
    .map(({ meta, cents }) => ({ ...meta, total: cents / 100 }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Income vs expense per month for the last N months, oldest first.
 * Months are the user's calendar months (§50).
 */
export async function getMonthlyTrend(userId: string, timeZone: string, months: number) {
  const now = new Date();
  const { year, month } = partsInZone(now, timeZone);
  const out: { month: string; label: string; income: number; spending: number }[] = [];

  for (let back = months - 1; back >= 0; back--) {
    // Walk back through calendar months without relying on Date arithmetic
    // that would use the server's zone.
    let targetYear = year;
    let targetMonth = month - back;
    while (targetMonth <= 0) {
      targetMonth += 12;
      targetYear -= 1;
    }

    const { start, end } = monthRangeInZone(timeZone, targetYear, targetMonth);
    const { spending, income } = await getCashflow(userId, start, end);

    out.push({
      month: `${targetYear}-${String(targetMonth).padStart(2, "0")}`,
      label: new Date(Date.UTC(targetYear, targetMonth - 1, 1)).toLocaleDateString("en-US", {
        month: "short",
        timeZone: "UTC",
      }),
      income,
      spending,
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
        amount: true,
        category: { select: { id: true, name: true, icon: true, color: true, group: true, inBudget: true } },
      },
    }),
    getSpendingByCategory(userId, start, end),
  ]);

  const spentByCategory = new Map(spendByCategory.map((s) => [s.categoryId, s.total]));

  return budgets
    .map((budget) => ({
      id: budget.id,
      categoryId: budget.categoryId,
      category: budget.category,
      limit: budget.amount,
      spent: spentByCategory.get(budget.categoryId) ?? 0,
    }))
    // Guard the divide: a zero limit would otherwise sort as NaN/Infinity.
    .sort((a, b) => {
      const ratioA = a.limit > 0 ? a.spent / a.limit : a.spent > 0 ? Infinity : 0;
      const ratioB = b.limit > 0 ? b.spent / b.limit : b.spent > 0 ? Infinity : 0;
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
      amount: true,
      reimbursedAmount: true,
      category: { select: { id: true, name: true, icon: true, color: true } },
    },
    orderBy: { date: "desc" },
    take: 500,
  });

  const items = owed.map((transaction) => ({
    id: transaction.id,
    name: transaction.merchantName || transaction.name,
    date: transaction.date,
    amount: transaction.amount,
    reimbursed: transaction.reimbursedAmount,
    outstanding: effectiveSpend(transaction.amount, transaction.reimbursedAmount),
    category: transaction.category,
  }));

  const totalOwed = sumBy(items, (item) => item.outstanding);

  const recentIncome = await prisma.transaction.findMany({
    where: { userId, amount: { lt: 0 } },
    select: { id: true, name: true, merchantName: true, date: true, amount: true },
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
      amount: roundMoney(-transaction.amount), // shown as positive money-in
    }));

  return {
    totalOwed,
    items,
    outstanding: items.filter((item) => item.outstanding > 0),
    possibleRepayments,
  };
}
