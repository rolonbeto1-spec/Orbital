import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  currentMonthRange,
  getCashflow,
  getNetWorth,
  getBudgetsWithSpend,
  getSpendingByCategory,
} from "@/lib/queries";
import { plaidConfigured } from "@/lib/plaid";
import { ensureDemoData } from "@/lib/db-helpers";

// One call powering the home dashboard.
export async function GET() {
  await ensureDemoData();
  const { start, end } = currentMonthRange();
  const [netWorth, cashflow, accounts, budgets, byCategory, recent, goals, itemCount, propertiesRaw] =
    await Promise.all([
      getNetWorth(),
      getCashflow(start, end),
      prisma.account.findMany({ orderBy: { currentBalance: "desc" } }),
      getBudgetsWithSpend(),
      getSpendingByCategory(start, end),
      prisma.transaction.findMany({
        orderBy: { date: "desc" },
        take: 6,
        include: { category: true, account: { select: { name: true, mask: true } } },
      }),
      prisma.goal.findMany({ orderBy: { createdAt: "asc" } }),
      prisma.item.count(),
      prisma.property.findMany({ orderBy: { createdAt: "asc" } }),
    ]);

  const properties = propertiesRaw.map((p) => ({
    id: p.id,
    name: p.name,
    net: p.rentIncome - p.mortgage - p.utilities - p.hoa,
  }));

  return NextResponse.json({
    netWorth,
    cashflow,
    accounts,
    budgets: budgets.slice(0, 4),
    topCategories: byCategory.slice(0, 5),
    recent,
    goals,
    month: start.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    connectedBanks: itemCount,
    plaidConfigured,
    properties,
  });
}
