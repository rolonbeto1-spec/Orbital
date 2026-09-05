import { route, safeJson } from "@/lib/security/api";
import { prisma } from "@/lib/prisma";
import { requireOwned } from "@/lib/security/ownership";
import { budgetUpdate } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = route(
  { auth: "user", limits: ["write"], body: budgetUpdate },
  async (ctx) => {
    const id = ctx.params.id;
    await requireOwned("budget", id, ctx.user.id, { select: { id: true } });
    await prisma.budget.updateMany({
      where: { id, userId: ctx.user.id },
      data: { amount: ctx.body.amount },
    });
    const budget = await prisma.budget.findFirst({
      where: { id, userId: ctx.user.id },
      select: { id: true, amount: true, categoryId: true },
    });
    return safeJson(budget);
  },
);

export const DELETE = route({ auth: "user", limits: ["write"] }, async (ctx) => {
  const id = ctx.params.id;
  await requireOwned("budget", id, ctx.user.id, { select: { id: true } });
  await prisma.budget.deleteMany({ where: { id, userId: ctx.user.id } });
  return safeJson({ ok: true });
});
