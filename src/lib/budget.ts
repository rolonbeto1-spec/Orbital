import { prisma } from "@/lib/prisma";
import { WANTS_CATEGORIES } from "@/lib/buckets";
import { currentMonthRange, getSpendingByCategory } from "@/lib/queries";

// The budget is customizable: by default it counts Wants (discretionary)
// categories, but each category carries an optional user override — bills out,
// "miscellaneous" in, whatever fits. Everything budget-related resolves the
// effective set through here.

export function categoryInBudget(cat: { name: string; inBudget: boolean | null }): boolean {
  return cat.inBudget ?? WANTS_CATEGORIES.includes(cat.name);
}

export interface BudgetCategory {
  categoryId: string;
  name: string;
  icon: string;
  color: string;
  limit: number;
  spent: number;
}

export interface BudgetStatus {
  limit: number;
  spent: number;
  left: number;
  hasBudget: boolean;
  categories: BudgetCategory[]; // in-budget categories, spent desc
}

// This month's budget picture across the user's in-budget categories.
export async function getBudgetStatus(): Promise<BudgetStatus> {
  const { start, end } = currentMonthRange();
  const [categories, budgets, spend] = await Promise.all([
    prisma.category.findMany(),
    prisma.budget.findMany(),
    getSpendingByCategory(start, end),
  ]);
  const limitByCat = new Map(budgets.map((b) => [b.categoryId, b.amount]));
  const spentByCat = new Map(spend.map((s) => [s.categoryId, s.total]));

  const inBudget = categories.filter((c) => c.group === "expense" && categoryInBudget(c));
  const items: BudgetCategory[] = inBudget
    .map((c) => ({
      categoryId: c.id,
      name: c.name,
      icon: c.icon,
      color: c.color,
      limit: limitByCat.get(c.id) ?? 0,
      spent: spentByCat.get(c.id) ?? 0,
    }))
    .filter((c) => c.limit > 0 || c.spent > 0)
    .sort((a, b) => b.spent - a.spent);

  const limit = items.reduce((s, c) => s + c.limit, 0);
  const spent = items.reduce((s, c) => s + c.spent, 0);
  return { limit, spent, left: limit - spent, hasBudget: limit > 0, categories: items };
}

// Names of the categories currently counted in the budget.
export async function getBudgetCategoryNames(): Promise<string[]> {
  const categories = await prisma.category.findMany();
  return categories
    .filter((c) => c.group === "expense" && categoryInBudget(c))
    .map((c) => c.name);
}
