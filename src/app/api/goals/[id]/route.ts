import { route, safeJson } from "@/lib/security/api";
import { prisma } from "@/lib/prisma";
import { requireOwned } from "@/lib/security/ownership";
import { goalUpdate } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = route(
  { auth: "user", limits: ["write"], body: goalUpdate },
  async (ctx) => {
    const id = ctx.params.id;
    await requireOwned("goal", id, ctx.user.id, { select: { id: true } });

    const { targetDate, ...rest } = ctx.body;
    await prisma.goal.updateMany({
      where: { id, userId: ctx.user.id },
      data: {
        ...rest,
        ...(targetDate !== undefined
          ? { targetDate: targetDate ? new Date(targetDate) : null }
          : {}),
      },
    });
    const goal = await prisma.goal.findFirst({ where: { id, userId: ctx.user.id } });
    return safeJson(goal);
  },
);

export const DELETE = route({ auth: "user", limits: ["write"] }, async (ctx) => {
  const id = ctx.params.id;
  await requireOwned("goal", id, ctx.user.id, { select: { id: true } });
  await prisma.goal.deleteMany({ where: { id, userId: ctx.user.id } });
  return safeJson({ ok: true });
});
