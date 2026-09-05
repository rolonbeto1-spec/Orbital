import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCashflow, getSpendingByCategory, monthRange } from "@/lib/queries";
import { detectRecurring } from "@/lib/recurring";
import { WANTS_CATEGORIES } from "@/lib/buckets";
import { getBudgetCategoryNames } from "@/lib/budget";

// One month of your money, summarized: what came in, what went out, where it
// went, how that compares to the month before, and the standout purchases.

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const now = new Date();
  const monthParam = searchParams.get("month"); // YYYY-MM
  let year = now.getFullYear();
  let month0 = now.getMonth();
  if (monthParam) {
    const [y, m] = monthParam.split("-").map(Number);
    if (y && m) {
      year = y;
      month0 = m - 1;
    }
  }

  const { start, end } = monthRange(year, month0);
  const prevStart = new Date(year, month0 - 1, 1);
  const { start: pStart, end: pEnd } = monthRange(prevStart.getFullYear(), prevStart.getMonth());
  const partial = now < end;

  const [flow, prevFlow, cats, prevCats, budgets, recurring, properties, txns] = await Promise.all([
    getCashflow(start, end),
    getCashflow(pStart, pEnd),
    getSpendingByCategory(start, end),
    getSpendingByCategory(pStart, pEnd),
    prisma.budget.findMany({ include: { category: true } }),
    detectRecurring(),
    prisma.property.findMany(),
    prisma.transaction.findMany({
      where: { date: { gte: start, lt: end }, amount: { gt: 0 }, account: { isBusiness: false } },
      include: { category: true },
    }),
  ]);

  const prevMap = new Map(prevCats.map((c) => [c.name, c.total]));
  const categories = cats.map((c) => {
    const prevTotal = prevMap.get(c.name) ?? 0;
    return {
      name: c.name,
      icon: c.icon,
      color: c.color,
      total: c.total,
      prevTotal,
      deltaPct: prevTotal > 0 ? Math.round(((c.total - prevTotal) / prevTotal) * 100) : null,
      isWant: WANTS_CATEGORIES.includes(c.name),
    };
  });
  const wantsTotal = categories.filter((c) => c.isWant).reduce((s, c) => s + c.total, 0);
  const needsTotal = categories.filter((c) => !c.isWant).reduce((s, c) => s + c.total, 0);

  // Top merchants and single biggest purchase (expenses only).
  const byMerchant = new Map<string, { total: number; count: number }>();
  let biggest: { name: string; amount: number; date: Date; category: string | null } | null = null;
  for (const t of txns) {
    if (t.category && t.category.group !== "expense") continue;
    const name = t.merchantName || t.name;
    const m = byMerchant.get(name) ?? { total: 0, count: 0 };
    m.total += t.amount;
    m.count++;
    byMerchant.set(name, m);
    if (!biggest || t.amount > biggest.amount) {
      biggest = { name, amount: t.amount, date: t.date, category: t.category?.name ?? null };
    }
  }
  const topMerchants = Array.from(byMerchant.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  // Budget block honors the user's customized in-budget category set.
  const budgetNames = await getBudgetCategoryNames();
  const wantsBudgetTotal = budgets
    .filter((b) => budgetNames.includes(b.category.name))
    .reduce((s, b) => s + b.amount, 0);
  const budgetSpent = categories
    .filter((c) => budgetNames.includes(c.name))
    .reduce((s, c) => s + c.total, 0);

  const rentalsNet = properties.reduce(
    (s, p) => s + (p.rentIncome - p.mortgage - p.utilities - p.hoa),
    0,
  );

  const net = flow.income - flow.spending;
  return NextResponse.json({
    month: `${year}-${String(month0 + 1).padStart(2, "0")}`,
    label: new Date(year, month0, 1).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    }),
    partial,
    income: flow.income,
    spending: flow.spending,
    net,
    savingsRate: flow.income > 0 ? Math.round((net / flow.income) * 100) : null,
    prev: {
      label: new Date(pStart).toLocaleDateString("en-US", { month: "long" }),
      income: prevFlow.income,
      spending: prevFlow.spending,
    },
    categories,
    needsTotal,
    wantsTotal,
    topMerchants,
    biggest,
    wantsBudget: wantsBudgetTotal > 0 ? { budget: wantsBudgetTotal, spent: budgetSpent } : null,
    recurringMonthly: Math.round(recurring.reduce((s, r) => s + r.monthlyCost, 0) * 100) / 100,
    rentals: properties.length > 0 ? { net: rentalsNet, count: properties.length } : null,
  });
}
