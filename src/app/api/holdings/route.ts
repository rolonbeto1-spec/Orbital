import { route, safeJson } from "@/lib/security/api";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route({ auth: "user", limits: ["read"] }, async (ctx) => {
  const holdings = await prisma.holding.findMany({
    where: { userId: ctx.user.id },
    select: {
      id: true, symbol: true, name: true, quantity: true, price: true,
      value: true, kind: true,
      account: { select: { id: true, name: true } },
    },
    orderBy: { value: "desc" },
    take: 500,
  });
  return safeJson({ holdings });
});
