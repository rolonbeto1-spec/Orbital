import { route, safeJson } from "@/lib/security/api";
import { prisma } from "@/lib/prisma";
import { requireOwned } from "@/lib/security/ownership";
import { goalUpdate } from "@/lib/validation";
import { dollarsToCents, serializeMoneyFields } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = route(
  { auth: "user", limits: ["write"], body: goalUpdate },
  async (ctx) => {
    const id = ctx.params.id;
    await requireOwned("goal", id, ctx.user.id, { select: { id: true } });

    const { targetDate, targetAmount, currentAmount, ...rest } = ctx.body;
    await prisma.goal.updateMany({
      where: { id, userId: ctx.user.id },
      data: {
        ...rest,
        // Dollars in the request become exact cents in the column.
        ...(targetAmount !== undefined
          ? { targetAmountCents: dollarsToCents(targetAmount) }
          : {}),
        ...(currentAmount !== undefined
          ? { currentAmountCents: dollarsToCents(currentAmount) }
          : {}),
        ...(targetDate !== undefined
          ? { targetDate: targetDate ? new Date(targetDate) : null }
          : {}),
      },
    });
    const goal = await prisma.goal.findFirst({ where: { id, userId: ctx.user.id } });
    return safeJson(goal ? serializeMoneyFields(goal) : null);
  },
);

export const DELETE = route({ auth: "user", limits: ["write"] }, async (ctx) => {
  const id = ctx.params.id;
  await requireOwned("goal", id, ctx.user.id, { select: { id: true } });
  await prisma.goal.deleteMany({ where: { id, userId: ctx.user.id } });
  return safeJson({ ok: true });
});
