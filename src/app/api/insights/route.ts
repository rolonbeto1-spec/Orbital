import { NextResponse } from "next/server";
import {
  currentMonthRange,
  monthRange,
  getCashflow,
  getSpendingByCategory,
  getMonthlyTrend,
  getNetWorth,
} from "@/lib/queries";

export async function GET() {
  const { start, end } = currentMonthRange();
  const prev = monthRange(start.getFullYear(), start.getMonth() - 1);

  const [cashflow, byCategory, prevByCategory, trend, netWorth] = await Promise.all([
    getCashflow(start, end),
    getSpendingByCategory(start, end),
    getSpendingByCategory(prev.start, prev.end),
    getMonthlyTrend(6),
    getNetWorth(),
  ]);

  // Attach a vs-last-month trend to each category. For spending, up = bad.
  const prevMap = new Map(prevByCategory.map((c) => [c.categoryId, c.total]));
  const withTrend = byCategory.map((c) => {
    const prevTotal = prevMap.get(c.categoryId) ?? 0;
    const pct =
      prevTotal > 0 ? Math.round(((c.total - prevTotal) / prevTotal) * 100) : c.total > 0 ? 100 : 0;
    return { ...c, prevTotal, pct };
  });

  return NextResponse.json({
    cashflow,
    byCategory: withTrend,
    trend,
    netWorth,
    month: start.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
  });
}
