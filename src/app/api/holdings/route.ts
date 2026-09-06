import { route, safeJson } from "@/lib/security/api";
import { prisma } from "@/lib/prisma";
import { serializeMoneyFields } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route({ auth: "user", limits: ["read"] }, async (ctx) => {
  const holdings = await prisma.holding.findMany({
    where: { userId: ctx.user.id },
    select: {
      id: true, symbol: true, name: true, quantity: true, priceUsd: true,
      valueCents: true, kind: true,
      account: { select: { id: true, name: true } },
    },
    orderBy: { valueCents: "desc" },
    take: 500,
  });
  // quantity and priceUsd pass through unchanged — neither is integer cents,
  // and both are documented in the schema as deliberately non-integer.
  return safeJson({ holdings: holdings.map((h) => serializeMoneyFields(h)) });
});
