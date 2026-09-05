import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { monthRange } from "@/lib/queries";

// The business breakdown: everything scoped to accounts marked as business.
// Earnings, expenses, net profit — this month and across recent months.
export async function GET() {
  const accounts = await prisma.account.findMany({
    where: { isBusiness: true },
    include: { item: { select: { institutionName: true } } },
  });
  if (accounts.length === 0) {
    return NextResponse.json({ accounts: [], configured: false });
  }
  const ids = accounts.map((a) => a.id);
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  const txns = await prisma.transaction.findMany({
    where: { accountId: { in: ids }, date: { gte: sixMonthsAgo } },
    include: { category: true },
    orderBy: { date: "desc" },
  });

  // Monthly earnings / expenses / net for the last 6 months.
  const months: { month: string; label: string; income: number; expenses: number; net: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const { start, end } = monthRange(d.getFullYear(), d.getMonth());
    const inMonth = txns.filter((t) => t.date >= start && t.date < end);
    const income = inMonth.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0);
    const expenses = inMonth
      .filter((t) => t.amount > 0 && t.category?.group !== "transfer")
      .reduce((s, t) => s + t.amount, 0);
    months.push({
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-US", { month: "short" }),
      income: Math.round(income * 100) / 100,
      expenses: Math.round(expenses * 100) / 100,
      net: Math.round((income - expenses) * 100) / 100,
    });
  }
  const current = months[months.length - 1];

  // Top expense merchants this month + overall expense categories.
  const { start: mStart } = monthRange(now.getFullYear(), now.getMonth());
  const monthExpenses = txns.filter((t) => t.date >= mStart && t.amount > 0);
  const byMerchant = new Map<string, { total: number; count: number }>();
  for (const t of monthExpenses) {
    const name = t.merchantName || t.name;
    const m = byMerchant.get(name) ?? { total: 0, count: 0 };
    m.total += t.amount;
    m.count++;
    byMerchant.set(name, m);
  }
  const topExpenses = Array.from(byMerchant.entries())
    .map(([name, v]) => ({ name, total: Math.round(v.total * 100) / 100, count: v.count }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return NextResponse.json({
    configured: true,
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      mask: a.mask,
      bank: a.item.institutionName,
      balance: a.currentBalance,
    })),
    thisMonth: current,
    months,
    topExpenses,
    recent: txns.slice(0, 8).map((t) => ({
      id: t.id,
      date: t.date,
      name: t.merchantName || t.name,
      amount: t.amount,
      category: t.category?.name ?? null,
      icon: t.category?.icon ?? null,
      color: t.category?.color ?? null,
    })),
  });
}
