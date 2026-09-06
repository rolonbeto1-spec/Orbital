import { route, safeJson } from "@/lib/security/api";
import { listItemsForUser } from "@/lib/plaid-items";
import { serializeMoneyFields } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The user's bank connections and accounts.
 *
 * listItemsForUser uses an explicit `select` that excludes
 * `accessTokenCipher`, so the encrypted Plaid credential cannot reach the
 * browser even by accident (§9).
 */
export const GET = route({ auth: "user", limits: ["read"] }, async (ctx) => {
  const items = await listItemsForUser(ctx.user.id);
  // Cents -> dollars once, at the boundary (§49).
  return safeJson({ items: items.map((item) => serializeMoneyFields(item)) });
});
