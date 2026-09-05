import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentMonthRange, getSpendingByCategory } from "@/lib/queries";
import { categoryInBudget } from "@/lib/budget";
import { ensureCategories } from "@/lib/db-helpers";

// Powers the budgets screen's two-part model:
//  - In budget: the categories the user counts (defaults to Wants), editable
//    limits — the real budget.
//  - Out of budget: committed/fixed spending, tracked but not counted. Any
//    category can be moved between the two sides.
export async function GET() {
  await ensureCategories();
  const { start, end } = currentMonthRange();

  const [byCategory, budgets, categories] = await Promise.all([
    getSpendingByCategory(start, end),
    prisma.budget.findMany({ include: { category: true } }),
    prisma.category.findMany(),
  ]);

  const spentByCat = new Map(byCategory.map((c) => [c.name, c.total]));
  const budgetByCat = new Map(budgets.map((b) => [b.category.name, b]));
  const expense = categories.filter((c) => c.group === "expense");

  const toItem = (c: (typeof expense)[number]) => {
    const b = budgetByCat.get(c.name);
    return {
      categoryId: c.id,
      name: c.name,
      icon: c.icon,
      color: c.color,
      budgetId: b?.id ?? null,
      limit: b?.amount ?? 0,
      spent: spentByCat.get(c.name) ?? 0,
      inBudget: categoryInBudget(c),
    };
  };

  const inBudgetItems = expense
    .filter((c) => categoryInBudget(c))
    .map(toItem)
    .sort((a, b) => {
      if (!!b.limit !== !!a.limit) return b.limit ? 1 : -1;
      return b.spent - a.spent;
    });

  const fixedItems = expense
    .filter((c) => !categoryInBudget(c))
    .map(toItem)
    .filter((x) => x.spent > 0)
    .sort((a, b) => b.spent - a.spent);

  const wantsBudget = inBudgetItems.reduce((s, x) => s + x.limit, 0);
  const wantsSpent = inBudgetItems.reduce((s, x) => s + x.spent, 0);

  return NextResponse.json({
    month: start.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    fixed: { total: fixedItems.reduce((s, x) => s + x.spent, 0), items: fixedItems },
    wants: {
      budget: wantsBudget,
      spent: wantsSpent,
      hasBudget: inBudgetItems.some((x) => x.limit > 0),
      items: inBudgetItems,
    },
  });
}
