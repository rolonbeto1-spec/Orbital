import { route, safeJson, HttpError } from "@/lib/security/api";
import { prisma } from "@/lib/prisma";
import { propertyCreate } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route({ auth: "user", limits: ["read"] }, async (ctx) => {
  const properties = await prisma.property.findMany({
    where: { userId: ctx.user.id },
    orderBy: { createdAt: "asc" },
  });
  return safeJson({ properties });
});

export const POST = route(
  { auth: "user", limits: ["write"], body: propertyCreate },
  async (ctx) => {
    const count = await prisma.property.count({ where: { userId: ctx.user.id } });
    if (count >= 100) throw new HttpError(400, "too many", "You have too many properties.");

    const property = await prisma.property.create({
      data: { userId: ctx.user.id, ...ctx.body },
    });
    return safeJson(property);
  },
);
