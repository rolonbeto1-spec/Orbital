import { route, safeJson } from "@/lib/security/api";
import { prisma } from "@/lib/prisma";
import { weekRange } from "@/lib/time";
import { sumBy, effectiveSpend, roundMoney } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Your week in 20 seconds — this user's last 7 days vs the 7 before.
 *
 * The week boundary is the user's own midnight, so somebody in Auckland and
 * somebody in Los Angeles each get their own seven days rather than sharing
 * the server's (§50).
 */
export const GET = route({ auth: "user", limits: ["read"] }, async (ctx) => {
  const { id: userId, timezone } = ctx.user;
  const now = new Date();
  const { start: weekStart } = weekRange(timezone, now);
  const prevStart = new Date(weekStart.getTime() - 7 * 86_400_000);

  const txns = await prisma.transaction.findMany({
    where: {
      userId,
      date: { gte: prevStart, lte: now },
      account: { isBusiness: false },
    },
    select: {
      id: true, date: true, name: true, merchantName: true, amount: true,
      owedBack: true, reimbursedAmount: true,
      category: { select: { name: true, icon: true, color: true, group: true } },
    },
    take: 5000,
  });

  const week = txns.filter((t) => t.date >= weekStart);
  const prev = txns.filter((t) => t.date < weekStart);

  const spendOf = (list: typeof txns) =>
    sumBy(
      list.filter((t) => t.amount > 0 && t.category?.group !== "transfer"),
      (t) => (t.owedBack ? effectiveSpend(t.amount, t.reimbursedAmount) : t.amount),
    );
  const incomeOf = (list: typeof txns) =>
    sumBy(
      list.filter((t) => t.amount < 0 && t.category?.group !== "transfer"),
      (t) => -t.amount,
    );

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
    .map(([name, total]) => ({ name, total: roundMoney(total) }));

  const biggest = week
    .filter((t) => t.amount > 0 && t.category?.group !== "transfer")
    .sort((a, b) => b.amount - a.amount)[0];

  return safeJson({
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
});
