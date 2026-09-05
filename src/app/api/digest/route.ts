import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Your week in 20 seconds: last 7 days of personal money vs the 7 before.
export async function GET() {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);
  const prevStart = new Date(weekStart);
  prevStart.setDate(prevStart.getDate() - 7);

  const txns = await prisma.transaction.findMany({
    where: { date: { gte: prevStart, lte: now }, account: { isBusiness: false } },
    include: { category: true },
  });

  const week = txns.filter((t) => t.date >= weekStart);
  const prev = txns.filter((t) => t.date < weekStart);

  const spendOf = (list: typeof txns) =>
    list
      .filter((t) => t.amount > 0 && t.category?.group !== "transfer")
      .reduce((s, t) => s + (t.owedBack ? Math.max(0, t.amount - t.reimbursedAmount) : t.amount), 0);
  const incomeOf = (list: typeof txns) =>
    list.filter((t) => t.amount < 0 && t.category?.group !== "transfer").reduce((s, t) => s - t.amount, 0);

  const spending = spendOf(week);
  const prevSpending = spendOf(prev);
  const income = incomeOf(week);

  const byCategory = new Map<string, number>();
  for (const t of week) {
    if (t.amount <= 0 || t.category?.group === "transfer") continue;
    const name = t.category?.name ?? "Not sorted yet";
    byCategory.set(name, (byCategory.get(name) ?? 0) + t.amount);
  }
  const topCategories = [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, total]) => ({ name, total: Math.round(total * 100) / 100 }));

  const biggest = week
    .filter((t) => t.amount > 0 && t.category?.group !== "transfer")
    .sort((a, b) => b.amount - a.amount)[0];

  return NextResponse.json({
    spending: Math.round(spending * 100) / 100,
    prevSpending: Math.round(prevSpending * 100) / 100,
    trendPct:
      prevSpending > 0 ? Math.round(((spending - prevSpending) / prevSpending) * 100) : null,
    income: Math.round(income * 100) / 100,
    topCategories,
    biggest: biggest
      ? { merchant: biggest.merchantName || biggest.name, amount: biggest.amount }
      : null,
  });
}
