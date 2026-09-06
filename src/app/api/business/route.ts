import { route, safeJson } from "@/lib/security/api";
import { prisma } from "@/lib/prisma";
import { monthRangeInZone, partsInZone } from "@/lib/time";
import { sumCentsBy, serializeMoneyFields } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The business breakdown — this user's accounts marked as business.
 *
 * Note the double scoping on the transaction query: `userId` AND an account
 * id list that was itself derived from a userId-scoped query. The account ids
 * come from our own database rather than the request, but the tenancy stays
 * in the WHERE clause regardless (§7 defence in depth).
 */
export const GET = route({ auth: "user", limits: ["read"] }, async (ctx) => {
  const { id: userId, timezone } = ctx.user;

  const accounts = await prisma.account.findMany({
    where: { userId, isBusiness: true },
    select: {
      id: true, name: true, mask: true, currentBalanceCents: true,
      item: { select: { institutionName: true } },
    },
  });
  if (accounts.length === 0) {
    return safeJson({ accounts: [], configured: false });
  }

  const ids = accounts.map((a) => a.id);
  const now = new Date();
  const { year, month } = partsInZone(now, timezone);
  let startYear = year;
  let startMonth = month - 5;
  while (startMonth <= 0) { startMonth += 12; startYear -= 1; }
  const sixMonthsAgo = monthRangeInZone(timezone, startYear, startMonth).start;

  const txns = await prisma.transaction.findMany({
    where: { userId, accountId: { in: ids }, date: { gte: sixMonthsAgo } },
    select: {
      id: true, date: true, name: true, merchantName: true, amountCents: true,
      category: { select: { name: true, icon: true, color: true, group: true } },
    },
    orderBy: { date: "desc" },
    take: 5000,
  });

  // Monthly earnings / expenses / net for the last 6 months.
  const months: {
    month: string;
    label: string;
    incomeCents: number;
    expensesCents: number;
    netCents: number;
  }[] = [];
  for (let i = 5; i >= 0; i--) {
    let mYear = year;
    let mMonth = month - i;
    while (mMonth <= 0) { mMonth += 12; mYear -= 1; }
    const { start, end } = monthRangeInZone(timezone, mYear, mMonth);
    const inMonth = txns.filter((t) => t.date >= start && t.date < end);
    const income = sumCentsBy(
      inMonth.filter((t) => t.amountCents < 0),
      (t) => -t.amountCents,
    );
    const expenses = sumCentsBy(
      inMonth.filter((t) => t.amountCents > 0 && t.category?.group !== "transfer"),
      (t) => t.amountCents,
    );
    months.push({
      month: `${mYear}-${String(mMonth).padStart(2, "0")}`,
      label: new Date(Date.UTC(mYear, mMonth - 1, 1)).toLocaleDateString("en-US", {
        month: "short",
        timeZone: "UTC",
      }),
      incomeCents: income,
      expensesCents: expenses,
      netCents: income - expenses,
    });
  }
  const current = months[months.length - 1];

  // Top expense merchants this month + overall expense categories.
  const { start: mStart } = monthRangeInZone(timezone, year, month);
  const monthExpenses = txns.filter((t) => t.date >= mStart && t.amountCents > 0);
  const byMerchant = new Map<string, { total: number; count: number }>();
  for (const t of monthExpenses) {
    const name = t.merchantName || t.name;
    const m = byMerchant.get(name) ?? { total: 0, count: 0 };
    m.total += t.amountCents;
    m.count++;
    byMerchant.set(name, m);
  }
  const topExpenses = Array.from(byMerchant.entries())
    .map(([name, v]) => ({ name, totalCents: v.total, count: v.count }))
    .sort((a, b) => b.totalCents - a.totalCents)
    .slice(0, 5);

  return safeJson({
    configured: true,
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      mask: a.mask,
      bank: a.item.institutionName,
      balance: a.currentBalanceCents / 100,
    })),
    thisMonth: current ? serializeMoneyFields(current) : null,
    months: months.map((m) => serializeMoneyFields(m)),
    topExpenses: topExpenses.map((e) => serializeMoneyFields(e)),
    recent: txns.slice(0, 8).map((t) => ({
      id: t.id,
      date: t.date,
      name: t.merchantName || t.name,
      amount: t.amountCents / 100,
      category: t.category?.name ?? null,
      icon: t.category?.icon ?? null,
      color: t.category?.color ?? null,
    })),
  });
});
