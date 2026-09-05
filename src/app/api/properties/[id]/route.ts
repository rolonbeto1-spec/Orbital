import { route, safeJson } from "@/lib/security/api";
import { prisma } from "@/lib/prisma";
import { requireOwned } from "@/lib/security/ownership";
import { propertyUpdate } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = route(
  { auth: "user", limits: ["write"], body: propertyUpdate },
  async (ctx) => {
    const id = ctx.params.id;
    await requireOwned("property", id, ctx.user.id, { select: { id: true } });
    await prisma.property.updateMany({
      where: { id, userId: ctx.user.id },
      data: ctx.body,
    });
    const property = await prisma.property.findFirst({ where: { id, userId: ctx.user.id } });
    return safeJson(property);
  },
);

export const DELETE = route({ auth: "user", limits: ["write"] }, async (ctx) => {
  const id = ctx.params.id;
  await requireOwned("property", id, ctx.user.id, { select: { id: true } });
  await prisma.property.deleteMany({ where: { id, userId: ctx.user.id } });
  return safeJson({ ok: true });
});
