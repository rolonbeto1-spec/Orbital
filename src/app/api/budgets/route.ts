import { route, safeJson } from "@/lib/security/api";
import { prisma } from "@/lib/prisma";
import { assertOwned } from "@/lib/security/ownership";
import { budgetCreate } from "@/lib/validation";
import { dollarsToCents, serializeMoneyFields } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route({ auth: "user", limits: ["read"] }, async (ctx) => {
  const budgets = await prisma.budget.findMany({
    where: { userId: ctx.user.id },
    select: {
      id: true, amountCents: true, categoryId: true,
      category: { select: { id: true, name: true, icon: true, color: true, group: true } },
    },
  });
  return safeJson({ budgets: budgets.map((b) => serializeMoneyFields(b)) });
});

/**
 * Create or update a monthly limit for one of the user's categories.
 *
 * The category id is ownership-checked before use: without that, a request
 * naming another tenant's category would create a budget row pointing across
 * the tenant boundary (§7).
 */
export const POST = route(
  { auth: "user", limits: ["write"], body: budgetCreate },
  async (ctx) => {
    await assertOwned("category", ctx.body.categoryId, ctx.user.id);

    // Upsert on the unique categoryId. Two concurrent requests cannot create
    // two budgets for one category (§48).
    const budget = await prisma.budget.upsert({
      where: { categoryId: ctx.body.categoryId },
      create: {
        userId: ctx.user.id,
        categoryId: ctx.body.categoryId,
        // The request carries dollars; stored as exact cents.
        amountCents: dollarsToCents(ctx.body.amount),
      },
      update: { amountCents: dollarsToCents(ctx.body.amount) },
      select: { id: true, amountCents: true, categoryId: true },
    });
    return safeJson(serializeMoneyFields(budget));
  },
);
