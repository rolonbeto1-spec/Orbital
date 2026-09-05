import { route, safeJson } from "@/lib/security/api";
import {
  getCashflow,
  getSpendingByCategory,
  getMonthlyTrend,
  getNetWorth,
} from "@/lib/queries";
import { currentMonthRange, monthRangeInZone, partsInZone } from "@/lib/time";

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
  const prevMap = new Map(prevByCategory.map((c) => [c.categoryId, c.total]));
  const withTrend = byCategory.map((c) => {
    const prevTotal = prevMap.get(c.categoryId) ?? 0;
    const pct =
      prevTotal > 0 ? Math.round(((c.total - prevTotal) / prevTotal) * 100) : c.total > 0 ? 100 : 0;
    return { ...c, prevTotal, pct };
  });

  return safeJson({
    cashflow,
    byCategory: withTrend,
    trend,
    netWorth,
    // Rendered in the user's zone so the label matches the period it covers.
    month: start.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: timezone }),
  });
});
