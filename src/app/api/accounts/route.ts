import { route, safeJson } from "@/lib/security/api";
import { listItemsForUser } from "@/lib/plaid-items";
import { getNetWorth } from "@/lib/queries";
import { plaidConfigured } from "@/lib/plaid";
import { serializeMoneyFields } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The user's bank connections and accounts, plus the totals the Accounts
 * screen puts at the top of the page.
 *
 * The net-worth figures are part of this response because the screen renders
 * them. It previously returned `{ items }` alone while the page read
 * `netWorth`, `assets` and `liabilities` from it — and since `useApi<T>` only
 * asserts a type rather than checking one, nothing failed loudly: the page
 * simply displayed "$NaN" for every total.
 *
 * listItemsForUser uses an explicit `select` that excludes
 * `accessTokenCipher`, so the encrypted Plaid credential cannot reach the
 * browser even by accident (§9).
 */
export const GET = route({ auth: "user", limits: ["read"] }, async (ctx) => {
  const [items, netWorth] = await Promise.all([
    listItemsForUser(ctx.user.id),
    getNetWorth(ctx.user.id),
  ]);

  // Cents -> dollars once, at the boundary (§49).
  const serializedItems = items.map((item) => serializeMoneyFields(item));

  return safeJson({
    items: serializedItems,
    // The same accounts, flattened, for screens that want one list rather
    // than a list per institution.
    accounts: serializedItems.flatMap(
      (item) => (item as { accounts?: unknown[] }).accounts ?? [],
    ),
    ...serializeMoneyFields(netWorth),
    plaidConfigured,
  });
});
