import { route, safeJson } from "@/lib/security/api";
import { prisma } from "@/lib/prisma";
import { requireOwned } from "@/lib/security/ownership";
import { accessTokenForOwnedItem } from "@/lib/plaid-items";
import { plaidClient, plaidErrorCode } from "@/lib/plaid";
import { recordAudit } from "@/lib/security/audit";
import { sendSecurityNotice } from "@/lib/mail";
import { log } from "@/lib/security/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Disconnect a bank (§11).
 *
 * Order matters: revoke at Plaid first, while the credential can still be
 * decrypted, then delete locally. Deleting first would leave a live
 * connection at Plaid that we no longer have the token to revoke.
 *
 * A user can only remove their own connection — requireOwned makes another
 * tenant's item id indistinguishable from a nonexistent one.
 *
 * Data retention: removing a connection deletes its accounts and
 * transactions by cascade. Metta does not keep the financial history of a
 * bank the user has disconnected (documented in the Privacy Policy).
 */
export const DELETE = route({ auth: "user", limits: ["write"] }, async (ctx) => {
  const id = ctx.params.id;
  const item = await requireOwned<{ id: string; institutionId: string | null }>(
    "item",
    id,
    ctx.user.id,
    { select: { id: true, institutionId: true } },
  );

  // Best effort revocation at Plaid.
  if (plaidClient) {
    try {
      const accessToken = await accessTokenForOwnedItem(id, ctx.user.id);
      if (accessToken) await plaidClient.itemRemove({ access_token: accessToken });
    } catch (error) {
      // Not fatal for the user's request, but it means a connection may
      // survive at Plaid and needs manual cleanup.
      const code = plaidErrorCode(error);
      log.error("Could not revoke Plaid item on disconnect", { itemId: id, code });
      await recordAudit({
        userId: ctx.user.id,
        type: "plaid.revoke_failed",
        outcome: "failure",
        meta: { itemId: id, code },
      });
    }
  }

  // Scoped delete. Cascades to accounts, transactions and holdings.
  await prisma.item.deleteMany({ where: { id, userId: ctx.user.id } });

  await recordAudit({
    userId: ctx.user.id,
    type: "plaid.item.removed",
    meta: { itemId: item.id, institutionId: item.institutionId },
  });
  await sendSecurityNotice(ctx.user.email, "bank-disconnected");

  return safeJson({ ok: true });
});
