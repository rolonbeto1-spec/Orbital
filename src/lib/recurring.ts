import "server-only";
import { prisma } from "@/lib/prisma";

// Detects merchants that charge on a schedule — subscriptions, bills, rent.
// A merchant qualifies when it has 3+ charges at a near-regular interval
// (weekly / biweekly / monthly) with amounts that stay within ~20% of their
// median. Pure heuristics over the user's own history; no external data.

export interface RecurringCharge {
  merchant: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
  cadence: "weekly" | "biweekly" | "monthly";
  amount: number; // typical (median) charge
  monthlyCost: number; // normalized to per-month
  lastDate: string; // ISO date of most recent charge
  nextExpected: string; // ISO date estimate
  count: number;
}

const CADENCES = [
  { name: "weekly" as const, days: 7, tol: 2, perMonth: 4.33 },
  { name: "biweekly" as const, days: 14, tol: 3, perMonth: 2.17 },
  { name: "monthly" as const, days: 30.4, tol: 6, perMonth: 1 },
];

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Detect recurring charges for ONE user.
 *
 * Bounded at MAX_ROWS so a very long history cannot pull an unlimited number
 * of transactions into memory on an endpoint anyone can call repeatedly
 * (§51, §72).
 */
const MAX_ROWS = 4000;

export async function detectRecurring(userId: string): Promise<RecurringCharge[]> {
  const since = new Date();
  since.setDate(since.getDate() - 180);
  const txns = await prisma.transaction.findMany({
    where: {
      userId,
      date: { gte: since },
      amount: { gt: 0 },
      account: { isBusiness: false },
    },
    include: { category: { select: { name: true, icon: true, color: true, group: true } } },
    orderBy: { date: "asc" },
    take: MAX_ROWS,
  });

  const byMerchant = new Map<string, typeof txns>();
  for (const t of txns) {
    if (t.category && t.category.group !== "expense") continue;
    const key = (t.merchantName || t.name).trim();
    const arr = byMerchant.get(key) ?? [];
    arr.push(t);
    byMerchant.set(key, arr);
  }

  const out: RecurringCharge[] = [];
  for (const [merchant, list] of byMerchant) {
    if (list.length < 3) continue;

    const amounts = list.map((t) => t.amount);
    const med = median(amounts);
    // Steady price: most charges within 20% of the median (or a few dollars).
    const steady = amounts.filter((a) => Math.abs(a - med) <= Math.max(med * 0.2, 3));
    if (steady.length < 3) continue;

    const gaps: number[] = [];
    for (let i = 1; i < list.length; i++) {
      gaps.push((list[i].date.getTime() - list[i - 1].date.getTime()) / 86_400_000);
    }
    const medGap = median(gaps);
    const cadence = CADENCES.find((c) => Math.abs(medGap - c.days) <= c.tol);
    if (!cadence) continue;
    // Cadence must be consistent, not just a median artifact.
    const regular = gaps.filter((g) => Math.abs(g - cadence.days) <= cadence.tol);
    if (regular.length < Math.ceil(gaps.length * 0.6)) continue;

    const last = list[list.length - 1];
    const next = new Date(last.date);
    next.setDate(next.getDate() + Math.round(cadence.days));

    out.push({
      merchant,
      categoryId: last.categoryId,
      categoryName: last.category?.name ?? null,
      categoryIcon: last.category?.icon ?? null,
      categoryColor: last.category?.color ?? null,
      cadence: cadence.name,
      amount: Math.round(med * 100) / 100,
      monthlyCost: Math.round(med * cadence.perMonth * 100) / 100,
      lastDate: last.date.toISOString(),
      nextExpected: next.toISOString(),
      count: list.length,
    });
  }

  return out.sort((a, b) => b.monthlyCost - a.monthlyCost);
}
