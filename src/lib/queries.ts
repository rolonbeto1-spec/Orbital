import { prisma } from "@/lib/prisma";

// Account types treated as liabilities for net-worth math.
const LIABILITY_TYPES = new Set(["credit", "loan"]);

export function monthRange(year: number, month0: number) {
  // month0 is 0-indexed (0 = January)
  const start = new Date(year, month0, 1, 0, 0, 0, 0);
  const end = new Date(year, month0 + 1, 1, 0, 0, 0, 0);
  return { start, end };
}

export function currentMonthRange() {
  const now = new Date();
  return monthRange(now.getFullYear(), now.getMonth());
}

export async function getNetWorth() {
  const accounts = await prisma.account.findMany();
  let assets = 0;
  let liabilities = 0;
  // "True available": spendable cash minus card balances that haven't been
  // paid yet — the number that isn't inflated by an un-hit statement.
  let cash = 0;
  let cardDebt = 0;
  for (const a of accounts) {
    if (LIABILITY_TYPES.has(a.type)) liabilities += a.currentBalance;
    else assets += a.currentBalance;
    if (a.type === "depository") cash += a.availableBalance ?? a.currentBalance;
    if (a.type === "credit") cardDebt += a.currentBalance;
  }
  return {
    assets,
    liabilities,
    netWorth: assets - liabilities,
    trueAvailable: cash - cardDebt,
    cash,
    cardDebt,
  };
}

// Personal scope: business accounts get their own breakdown screen and stay
// out of personal budgets, cashflow, and the hive.
export const PERSONAL = { account: { isBusiness: false } } as const;

// Spending (expense group, money out) and income (income group, money in) for a range.
export async function getCashflow(start: Date, end: Date) {
  const txns = await prisma.transaction.findMany({
    where: { date: { gte: start, lt: end }, ...PERSONAL },
    include: { category: true },
  });
  let spending = 0;
  let income = 0;
  for (const t of txns) {
    const group = t.category?.group ?? "expense";
    if (group === "expense" && t.amount > 0) {
      spending += t.owedBack ? Math.max(0, t.amount - t.reimbursedAmount) : t.amount;
    }
    if (group === "income" && t.amount < 0) income += -t.amount;
  }
  return { spending, income, net: income - spending };
}

// Spending grouped by category for a range (expense group only, money out).
export async function getSpendingByCategory(start: Date, end: Date) {
  const txns = await prisma.transaction.findMany({
    where: { date: { gte: start, lt: end }, amount: { gt: 0 }, ...PERSONAL },
    include: { category: true },
  });
  const map = new Map<
    string,
    { categoryId: string; name: string; color: string; icon: string; total: number }
  >();
  for (const t of txns) {
    if (!t.category || t.category.group !== "expense") continue;
    // Net out any money paid back for reimbursable purchases.
    const eff = t.owedBack ? Math.max(0, t.amount - t.reimbursedAmount) : t.amount;
    if (eff <= 0) continue;
    const key = t.category.id;
    const existing = map.get(key);
    if (existing) existing.total += eff;
    else
      map.set(key, {
        categoryId: t.category.id,
        name: t.category.name,
        color: t.category.color,
        icon: t.category.icon,
        total: eff,
      });
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

// Income vs expense per month for the last N months (oldest first).
export async function getMonthlyTrend(months: number) {
  const now = new Date();
  const out: { month: string; label: string; income: number; spending: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const { start, end } = monthRange(d.getFullYear(), d.getMonth());
    const { spending, income } = await getCashflow(start, end);
    out.push({
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-US", { month: "short" }),
      income,
      spending,
    });
  }
  return out;
}

// Budgets with current-month spend for each.
export async function getBudgetsWithSpend() {
  const { start, end } = currentMonthRange();
  const budgets = await prisma.budget.findMany({ include: { category: true } });
  const spendByCat = await getSpendingByCategory(start, end);
  const spendMap = new Map(spendByCat.map((s) => [s.categoryId, s.total]));
  return budgets
    .map((b) => ({
      id: b.id,
      categoryId: b.categoryId,
      category: b.category,
      limit: b.amount,
      spent: spendMap.get(b.categoryId) ?? 0,
    }))
    .sort((a, b) => b.spent / b.limit - a.spent / a.limit);
}

// P2P sources that usually mean someone paid you back.
const REPAYMENT_SOURCES = ["cash app", "venmo", "zelle", "apple pay", "paypal", "payment from", "transfer from"];

// Outstanding "owed back" purchases + likely repayments that just landed.
export async function getReimbursements() {
  const owed = await prisma.transaction.findMany({
    where: { owedBack: true },
    include: { category: true, account: { select: { name: true, mask: true } } },
    orderBy: { date: "desc" },
  });
  const items = owed.map((t) => ({
    id: t.id,
    name: t.merchantName || t.name,
    date: t.date,
    amount: t.amount,
    reimbursed: t.reimbursedAmount,
    outstanding: Math.max(0, t.amount - t.reimbursedAmount),
    category: t.category,
  }));
  const totalOwed = items.reduce((s, i) => s + i.outstanding, 0);

  // Money-in transactions that look like a repayment (surface as suggestions).
  const recentIncome = await prisma.transaction.findMany({
    where: { amount: { lt: 0 } },
    orderBy: { date: "desc" },
    take: 40,
  });
  const possibleRepayments = recentIncome
    .filter((t) => {
      const hay = `${t.name} ${t.merchantName ?? ""}`.toLowerCase();
      return REPAYMENT_SOURCES.some((s) => hay.includes(s));
    })
    .slice(0, 6)
    .map((t) => ({
      id: t.id,
      name: t.merchantName || t.name,
      date: t.date,
      amount: -t.amount, // show as positive money-in
    }));

  return { totalOwed, items, outstanding: items.filter((i) => i.outstanding > 0), possibleRepayments };
}
