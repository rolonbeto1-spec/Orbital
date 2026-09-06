import { route, safeJson } from "@/lib/security/api";
import { prisma } from "@/lib/prisma";
import { getSpendingByCategory } from "@/lib/queries";
import { currentMonthRange } from "@/lib/time";
import { categoryInBudget } from "@/lib/budget";
import { sumCentsBy, serializeMoneyFields } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Budgets screen's two-part model, for one user:
 *   - In budget: the categories this user counts (defaults to Wants).
 *   - Out of budget: committed/fixed spending, tracked but not counted.
 *
 * Categories are per-user rows seeded at signup, so the old
 * `await ensureCategories()` bootstrap — which created one shared global
 * catalog — is gone (§6, §47).
 */
export const GET = route({ auth: "user", limits: ["read"] }, async (ctx) => {
  const { id: userId, timezone } = ctx.user;
  const { start, end } = currentMonthRange(timezone);

  const [byCategory, budgets, categories] = await Promise.all([
    getSpendingByCategory(userId, start, end),
    prisma.budget.findMany({
      where: { userId },
      select: { id: true, amountCents: true, category: { select: { name: true } } },
    }),
    prisma.category.findMany({
      where: { userId },
      select: { id: true, name: true, icon: true, color: true, group: true, inBudget: true },
    }),
  ]);

  const spentByCategory = new Map(byCategory.map((c) => [c.name, c.totalCents]));
  const budgetByCategory = new Map(budgets.map((b) => [b.category.name, b]));
  const expense = categories.filter((c) => c.group === "expense");

  const toItem = (category: (typeof expense)[number]) => {
    const budget = budgetByCategory.get(category.name);
    return {
      categoryId: category.id,
      name: category.name,
      icon: category.icon,
      color: category.color,
      budgetId: budget?.id ?? null,
      limitCents: budget?.amountCents ?? 0,
      spentCents: spentByCategory.get(category.name) ?? 0,
      inBudget: categoryInBudget(category),
    };
  };

  const items = expense.map(toItem);
  const inBudget = items.filter((i) => i.inBudget).sort((a, b) => b.spentCents - a.spentCents);
  const outOfBudget = items
    .filter((i) => !i.inBudget)
    .sort((a, b) => b.spentCents - a.spentCents);

  return safeJson({
    inBudget: inBudget.map((i) => serializeMoneyFields(i)),
    outOfBudget: outOfBudget.map((i) => serializeMoneyFields(i)),
    totals: serializeMoneyFields({
      limitCents: sumCentsBy(inBudget, (i) => i.limitCents),
      spentCents: sumCentsBy(inBudget, (i) => i.spentCents),
      committedCents: sumCentsBy(outOfBudget, (i) => i.spentCents),
    }),
    month: start.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: timezone }),
  });
});
