import { route, safeJson } from "@/lib/security/api";
import { prisma } from "@/lib/prisma";
import { requireOwned } from "@/lib/security/ownership";
import { categoryUpdate } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Override whether a category counts toward the budget.
 *
 * This is exactly the setting that made a shared global Category table
 * untenable: one tenant's "count Groceries in my budget" would have changed
 * everyone's budget. Per-user categories make it a private preference (§6).
 */
export const PATCH = route(
  { auth: "user", limits: ["write"], body: categoryUpdate },
  async (ctx) => {
    const id = ctx.params.id;
    await requireOwned("category", id, ctx.user.id, { select: { id: true } });
    await prisma.category.updateMany({
      where: { id, userId: ctx.user.id },
      data: { inBudget: ctx.body.inBudget },
    });
    const category = await prisma.category.findFirst({ where: { id, userId: ctx.user.id } });
    return safeJson(category);
  },
);
