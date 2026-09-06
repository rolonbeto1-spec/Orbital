import "server-only";
import { prisma } from "@/lib/prisma";
import { WANTS_CATEGORIES } from "@/lib/buckets";
import { getSpendingByCategory } from "@/lib/queries";
import { currentMonthRange } from "@/lib/time";
import { asCents, sumCentsBy } from "@/lib/money";

/**
 * The budget, per user.
 *
 * The budget counts "Wants" categories by default, and each category carries
 * an optional per-user override. Because categories are now per-user rows,
 * that override is genuinely private: previously a single global Category
 * table meant one person's `inBudget` choice would have changed everybody's
 * budget (§6).
 */

export function categoryInBudget(category: { name: string; inBudget: boolean | null }): boolean {
  return category.inBudget ?? WANTS_CATEGORIES.includes(category.name);
}

export interface BudgetCategory {
  categoryId: string;
  name: string;
  icon: string;
  color: string;
  limitCents: number;
  spentCents: number;
}

export interface BudgetStatus {
  limitCents: number;
  spentCents: number;
  leftCents: number;
  hasBudget: boolean;
  categories: BudgetCategory[];
}

/** This month's budget picture, in the user's own calendar month. */
export async function getBudgetStatus(
  userId: string,
  timeZone: string,
): Promise<BudgetStatus> {
  const { start, end } = currentMonthRange(timeZone);

  const [categories, budgets, spend] = await Promise.all([
    prisma.category.findMany({
      where: { userId },
      select: { id: true, name: true, icon: true, color: true, group: true, inBudget: true },
    }),
    prisma.budget.findMany({
      where: { userId },
      select: { categoryId: true, amountCents: true },
    }),
    getSpendingByCategory(userId, start, end),
  ]);

  const limitByCategory = new Map(budgets.map((b) => [b.categoryId, asCents(b.amountCents)]));
  const spentByCategory = new Map(spend.map((s) => [s.categoryId, s.totalCents]));

  const items: BudgetCategory[] = categories
    .filter((category) => category.group === "expense" && categoryInBudget(category))
    .map((category) => ({
      categoryId: category.id,
      name: category.name,
      icon: category.icon,
      color: category.color,
      limitCents: limitByCategory.get(category.id) ?? 0,
      spentCents: spentByCategory.get(category.id) ?? 0,
    }))
    .filter((item) => item.limitCents > 0 || item.spentCents > 0)
    .sort((a, b) => b.spentCents - a.spentCents);

  const limitCents = sumCentsBy(items, (item) => item.limitCents);
  const spentCents = sumCentsBy(items, (item) => item.spentCents);

  return {
    limitCents,
    spentCents,
    leftCents: limitCents - spentCents,
    hasBudget: limitCents > 0,
    categories: items,
  };
}

/** Names of the categories currently counted in this user's budget. */
export async function getBudgetCategoryNames(userId: string): Promise<string[]> {
  const categories = await prisma.category.findMany({
    where: { userId },
    select: { name: true, group: true, inBudget: true },
  });
  return categories
    .filter((category) => category.group === "expense" && categoryInBudget(category))
    .map((category) => category.name);
}
