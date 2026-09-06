import { route, safeJson } from "@/lib/security/api";
import {
  getCashflow,
  getSpendingByCategory,
  getMonthlyTrend,
  getNetWorth,
} from "@/lib/queries";
import { currentMonthRange, monthRangeInZone, partsInZone } from "@/lib/time";
import { serializeMoneyFields } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Insights overview. Every figure is computed from the signed-in user's
 * own transactions, over their own calendar months (§2, §50).
 */
export const GET = route({ auth: "user", limits: ["report"] }, async (ctx) => {
  const { id: userId, timezone } = ctx.user;
  const { start, end } = currentMonthRange(timezone);
  const { year, month } = partsInZone(new Date(), timezone);
  const prev = monthRangeInZone(timezone, month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1);

  const [cashflow, byCategory, prevByCategory, trend, netWorth] = await Promise.all([
    getCashflow(userId, start, end),
    getSpendingByCategory(userId, start, end),
    getSpendingByCategory(userId, prev.start, prev.end),
    getMonthlyTrend(userId, timezone, 6),
    getNetWorth(userId),
  ]);

  // Attach a vs-last-month trend to each category. For spending, up = bad.
  const prevMap = new Map(prevByCategory.map((c) => [c.categoryId, c.totalCents]));
  const withTrend = byCategory.map((c) => {
    const prevTotalCents = prevMap.get(c.categoryId) ?? 0;
    const pct =
      prevTotalCents > 0
        ? Math.round(((c.totalCents - prevTotalCents) / prevTotalCents) * 100)
        : c.totalCents > 0
          ? 100
          : 0;
    return { ...c, prevTotalCents, pct };
  });

  return safeJson({
    cashflow: serializeMoneyFields(cashflow),
    byCategory: withTrend.map((c) => serializeMoneyFields(c)),
    trend: trend.map((t) => serializeMoneyFields(t)),
    netWorth: serializeMoneyFields(netWorth),
    // Rendered in the user's zone so the label matches the period it covers.
    month: start.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: timezone }),
  });
});
