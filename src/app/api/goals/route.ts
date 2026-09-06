import { route, safeJson } from "@/lib/security/api";
import { prisma } from "@/lib/prisma";
import { goalCreate } from "@/lib/validation";
import { dollarsToCents, serializeMoneyFields } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route({ auth: "user", limits: ["read"] }, async (ctx) => {
  const goals = await prisma.goal.findMany({
    where: { userId: ctx.user.id },
    orderBy: { createdAt: "asc" },
  });
  return safeJson({ goals: goals.map((g) => serializeMoneyFields(g)) });
});

export const POST = route(
  { auth: "user", limits: ["write"], body: goalCreate },
  async (ctx) => {
    // Bounded so one account cannot create unlimited rows (§51).
    const existing = await prisma.goal.count({ where: { userId: ctx.user.id } });
    if (existing >= 100) {
      return safeJson({ error: "You have reached the maximum number of goals." }, { status: 400 });
    }

    const goal = await prisma.goal.create({
      data: {
        userId: ctx.user.id,
        name: ctx.body.name,
        targetAmountCents: dollarsToCents(ctx.body.targetAmount),
        currentAmountCents: dollarsToCents(ctx.body.currentAmount ?? 0),
        targetDate: ctx.body.targetDate ? new Date(ctx.body.targetDate) : null,
        icon: ctx.body.icon ?? "target",
        color: ctx.body.color ?? "#6366f1",
      },
    });
    return safeJson(serializeMoneyFields(goal));
  },
);
