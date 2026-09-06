import { route, safeJson, HttpError } from "@/lib/security/api";
import { prisma } from "@/lib/prisma";
import { propertyCreate } from "@/lib/validation";
import { dollarsToCents, serializeMoneyFields } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route({ auth: "user", limits: ["read"] }, async (ctx) => {
  const properties = await prisma.property.findMany({
    where: { userId: ctx.user.id },
    orderBy: { createdAt: "asc" },
  });
  return safeJson({ properties: properties.map((p) => serializeMoneyFields(p)) });
});

export const POST = route(
  { auth: "user", limits: ["write"], body: propertyCreate },
  async (ctx) => {
    const count = await prisma.property.count({ where: { userId: ctx.user.id } });
    if (count >= 100) throw new HttpError(400, "too many", "You have too many properties.");

    const { name, notes, ...amounts } = ctx.body;
    const property = await prisma.property.create({
      data: {
        userId: ctx.user.id,
        name,
        notes,
        // Every monetary field converted once, from dollars to exact cents.
        rentIncomeCents: dollarsToCents(amounts.rentIncome ?? 0),
        mortgageCents: dollarsToCents(amounts.mortgage ?? 0),
        utilitiesCents: dollarsToCents(amounts.utilities ?? 0),
        hoaCents: dollarsToCents(amounts.hoa ?? 0),
        sweatInCents: dollarsToCents(amounts.sweatIn ?? 0),
        sweatOutCents: dollarsToCents(amounts.sweatOut ?? 0),
      },
    });
    return safeJson(serializeMoneyFields(property));
  },
);
