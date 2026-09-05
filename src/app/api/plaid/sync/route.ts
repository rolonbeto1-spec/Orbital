import { z } from "zod";
import { route, safeJson } from "@/lib/security/api";
import { requireOwned } from "@/lib/security/ownership";
import { syncItemForUser, syncAllItemsForUser } from "@/lib/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const body = z
  .object({
    // Optional: sync one connection. Ownership-checked before use, so a user
    // cannot trigger a sync of somebody else's bank (§62).
    itemId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
  })
  .strict();

/**
 * Refresh bank data for the signed-in user.
 *
 * POST only — it consumes Plaid quota and writes to the database, so it must
 * not be reachable by a cross-site GET (§17).
 */
export const POST = route({ auth: "user", limits: ["plaidSync"], body }, async (ctx) => {
  if (ctx.body.itemId) {
    await requireOwned("item", ctx.body.itemId, ctx.user.id, { select: { id: true } });
    const result = await syncItemForUser(ctx.body.itemId, ctx.user.id);
    return safeJson(result);
  }
  const result = await syncAllItemsForUser(ctx.user.id);
  return safeJson(result);
});
