import { z } from "zod";
import { route, safeJson } from "@/lib/security/api";
import { prisma } from "@/lib/prisma";
import { getCashflow, getSpendingByCategory } from "@/lib/queries";
import { monthRangeInZone, partsInZone } from "@/lib/time";
import { detectRecurring } from "@/lib/recurring";
import { WANTS_CATEGORIES } from "@/lib/buckets";
import { getBudgetCategoryNames } from "@/lib/budget";
import { monthKey } from "@/lib/validation";
import { asCents, sumCentsBy, serializeMoneyFields } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const query = z.object({ month: monthKey.optional() }).strict();

// One month of your money, summarized: what came in, what went out, where it
// went, how that compares to the month before, and the standout purchases.

/**
 * The monthly report, for one user, over that user's calendar month.
 *
 * The month parameter is schema-validated (YYYY-MM within a sane year range),
 * so it cannot become an unbounded or nonsensical date window (§14, §51).
 */
export const GET = route({ auth: "user", limits: ["report"], query }, async (ctx) => {
  const { id: userId, timezone } = ctx.user;
  const now = new Date();

  const current = partsInZone(now, timezone);
  let year = current.year;
  let month = current.month; // 1-12
  if (ctx.query.month) {
    const [y, m] = ctx.query.month.split("-").map(Number);
    year = y;
    month = m;
  }
  const month0 = month - 1;

  const { start, end } = monthRangeInZone(timezone, year, month);
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const { start: pStart, end: pEnd } = monthRangeInZone(timezone, prevYear, prevMonth);
  const partial = now < end;

  const [flow, prevFlow, cats, prevCats, budgets, recurring, properties, txns] = await Promise.all([
    getCashflow(userId, start, end),
    getCashflow(userId, pStart, pEnd),
    getSpendingByCategory(userId, start, end),
    getSpendingByCategory(userId, pStart, pEnd),
    prisma.budget.findMany({
      where: { userId },
      select: { amountCents: true, category: { select: { name: true } } },
    }),
    detectRecurring(userId),
    prisma.property.findMany({ where: { userId } }),
    prisma.transaction.findMany({
      where: {
        userId,
        date: { gte: start, lt: end },
        amountCents: { gt: 0 },
        account: { isBusiness: false },
      },
      select: {
        name: true, merchantName: true, amountCents: true, date: true,
        category: { select: { name: true, group: true } },
      },
      take: 5000,
    }),
  ]);

  const prevMap = new Map(prevCats.map((c) => [c.name, c.totalCents]));
  const categories = cats.map((c) => {
    const prevTotalCents = prevMap.get(c.name) ?? 0;
    return {
      name: c.name,
      icon: c.icon,
      color: c.color,
      totalCents: c.totalCents,
      prevTotalCents,
      deltaPct:
        prevTotalCents > 0
          ? Math.round(((c.totalCents - prevTotalCents) / prevTotalCents) * 100)
          : null,
      isWant: WANTS_CATEGORIES.includes(c.name),
    };
  });
  const wantsTotal = sumCentsBy(categories.filter((c) => c.isWant), (c) => c.totalCents);
  const needsTotal = sumCentsBy(categories.filter((c) => !c.isWant), (c) => c.totalCents);

  // Top merchants and single biggest purchase (expenses only).
  const byMerchant = new Map<string, { total: number; count: number }>();
  let biggest:
    | { name: string; amountCents: number; date: Date; category: string | null }
    | null = null;
  for (const t of txns) {
    if (t.category && t.category.group !== "expense") continue;
    const name = t.merchantName || t.name;
    const m = byMerchant.get(name) ?? { total: 0, count: 0 };
    const amountCents = asCents(t.amountCents);
    m.total += amountCents;
    m.count++;
    byMerchant.set(name, m);
    if (!biggest || amountCents > biggest.amountCents) {
      biggest = {
        name,
        amountCents,
        date: t.date,
        category: t.category?.name ?? null,
      };
    }
  }
  const topMerchants = Array.from(byMerchant.entries())
    .map(([name, v]) => ({ name, totalCents: v.total, count: v.count }))
    .sort((a, b) => b.totalCents - a.totalCents)
    .slice(0, 5);

  // Budget block honors the user's customized in-budget category set.
  const budgetNames = await getBudgetCategoryNames(userId);
  const wantsBudgetTotal = sumCentsBy(
    budgets.filter((b) => budgetNames.includes(b.category.name)),
    (b) => b.amountCents,
  );
  const budgetSpent = sumCentsBy(
    categories.filter((c) => budgetNames.includes(c.name)),
    (c) => c.totalCents,
  );

  const rentalsNet = sumCentsBy(
    properties,
    (p) => p.rentIncomeCents - p.mortgageCents - p.utilitiesCents - p.hoaCents,
  );

  const netCents = flow.incomeCents - flow.spendingCents;
  return safeJson({
    month: `${year}-${String(month0 + 1).padStart(2, "0")}`,
    label: new Date(Date.UTC(year, month0, 1)).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
    partial,
    income: flow.incomeCents / 100,
    spending: flow.spendingCents / 100,
    net: netCents / 100,
    savingsRate:
      flow.incomeCents > 0 ? Math.round((netCents / flow.incomeCents) * 100) : null,
    prev: {
      label: new Date(Date.UTC(prevYear, prevMonth - 1, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }),
      income: prevFlow.incomeCents / 100,
      spending: prevFlow.spendingCents / 100,
    },
    // Everything below is converted from exact cents at this single boundary.
    categories: categories.map((c) => serializeMoneyFields(c)),
    needsTotal: needsTotal / 100,
    wantsTotal: wantsTotal / 100,
    topMerchants: topMerchants.map((m) => serializeMoneyFields(m)),
    biggest: biggest ? serializeMoneyFields(biggest) : null,
    wantsBudget:
      wantsBudgetTotal > 0
        ? { budget: wantsBudgetTotal / 100, spent: budgetSpent / 100 }
        : null,
    recurringMonthly: sumCentsBy(recurring, (r) => r.monthlyCostCents) / 100,
    rentals:
      properties.length > 0
        ? { net: rentalsNet / 100, count: properties.length }
        : null,
  });
});
