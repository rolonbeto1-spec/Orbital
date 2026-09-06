import { route, safeJson } from "@/lib/security/api";
import { prisma } from "@/lib/prisma";
import { requireOwned } from "@/lib/security/ownership";
import { propertyUpdate } from "@/lib/validation";
import { dollarsToCents, serializeMoneyFields } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = route(
  { auth: "user", limits: ["write"], body: propertyUpdate },
  async (ctx) => {
    const id = ctx.params.id;
    await requireOwned("property", id, ctx.user.id, { select: { id: true } });
    const { name, notes, rentIncome, mortgage, utilities, hoa, sweatIn, sweatOut } = ctx.body;
    await prisma.property.updateMany({
      where: { id, userId: ctx.user.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(rentIncome !== undefined ? { rentIncomeCents: dollarsToCents(rentIncome) } : {}),
        ...(mortgage !== undefined ? { mortgageCents: dollarsToCents(mortgage) } : {}),
        ...(utilities !== undefined ? { utilitiesCents: dollarsToCents(utilities) } : {}),
        ...(hoa !== undefined ? { hoaCents: dollarsToCents(hoa) } : {}),
        ...(sweatIn !== undefined ? { sweatInCents: dollarsToCents(sweatIn) } : {}),
        ...(sweatOut !== undefined ? { sweatOutCents: dollarsToCents(sweatOut) } : {}),
      },
    });
    const property = await prisma.property.findFirst({ where: { id, userId: ctx.user.id } });
    return safeJson(property ? serializeMoneyFields(property) : null);
  },
);

export const DELETE = route({ auth: "user", limits: ["write"] }, async (ctx) => {
  const id = ctx.params.id;
  await requireOwned("property", id, ctx.user.id, { select: { id: true } });
  await prisma.property.deleteMany({ where: { id, userId: ctx.user.id } });
  return safeJson({ ok: true });
});
