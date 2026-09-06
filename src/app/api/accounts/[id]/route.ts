import { route, safeJson } from "@/lib/security/api";
import { prisma } from "@/lib/prisma";
import { requireOwned } from "@/lib/security/ownership";
import { accountUpdate } from "@/lib/validation";
import { serializeMoneyFields } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Toggle an account's Business flag, which routes it to the Business screen
 * and out of the personal hive and budget.
 *
 * PATCH only, ownership enforced in the query (§7, §17).
 */
export const PATCH = route(
  { auth: "user", limits: ["write"], body: accountUpdate },
  async (ctx) => {
    const id = ctx.params.id;
    await requireOwned("account", id, ctx.user.id, { select: { id: true } });

    await prisma.account.updateMany({
      where: { id, userId: ctx.user.id },
      data: { isBusiness: ctx.body.isBusiness },
    });

    const account = await prisma.account.findFirst({
      where: { id, userId: ctx.user.id },
      select: {
        id: true, name: true, mask: true, type: true, subtype: true,
        currentBalanceCents: true, availableBalanceCents: true, isBusiness: true,
        currencyCode: true,
      },
    });
    return safeJson(account ? serializeMoneyFields(account) : null);
  },
);
