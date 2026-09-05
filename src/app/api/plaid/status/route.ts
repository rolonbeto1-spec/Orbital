import { route, safeJson } from "@/lib/security/api";
import { plaidConfigured } from "@/lib/plaid";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Whether this user has any bank connected, and whether any needs repair.
 *
 * Deliberately says nothing about Plaid credentials themselves beyond
 * "connections are available", which the UI needs to decide whether to show
 * the connect button.
 */
export const GET = route({ auth: "user", limits: ["read"] }, async (ctx) => {
  const [total, needsAttention] = await Promise.all([
    prisma.item.count({ where: { userId: ctx.user.id } }),
    prisma.item.count({
      where: {
        userId: ctx.user.id,
        status: { in: ["login_required", "consent_expired", "revoked", "error"] },
      },
    }),
  ]);

  return safeJson({
    available: plaidConfigured,
    connected: total > 0,
    itemCount: total,
    needsAttention,
  });
});
