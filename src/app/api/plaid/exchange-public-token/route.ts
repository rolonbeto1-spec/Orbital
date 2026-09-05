import { CountryCode } from "plaid";
import { route, safeJson, HttpError } from "@/lib/security/api";
import { plaidClient, plaidConfigured, plaidErrorCode } from "@/lib/plaid";
import { plaidExchange } from "@/lib/validation";
import { upsertItemForUser } from "@/lib/plaid-items";
import { syncItemForUser } from "@/lib/sync";
import { recordAudit } from "@/lib/security/audit";
import { sendSecurityNotice } from "@/lib/mail";
import { prisma } from "@/lib/prisma";
import { log } from "@/lib/security/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The initial sync pulls history and runs the AI passes; Vercel kills a
// function at ~10s without this.
export const maxDuration = 60;

/**
 * Exchange Plaid Link's public token for a durable access token (§8, §9).
 *
 * The access token is encrypted before it is stored and is never returned to
 * the browser — the response says which bank connected and how much synced,
 * and nothing else.
 */
export const POST = route(
  { auth: "user", limits: ["plaidExchange"], body: plaidExchange },
  async (ctx) => {
    if (!plaidConfigured || !plaidClient) {
      throw new HttpError(503, "Plaid not configured", "Bank connections are not available yet.");
    }

    let accessToken: string;
    let plaidItemId: string;
    try {
      const exchange = await plaidClient.itemPublicTokenExchange({
        public_token: ctx.body.public_token,
      });
      accessToken = exchange.data.access_token;
      plaidItemId = exchange.data.item_id;
    } catch (error) {
      const code = plaidErrorCode(error);
      log.warn("Plaid token exchange failed", { code });
      throw new HttpError(
        400,
        `plaid:${code ?? "unknown"}`,
        "That bank connection could not be completed. Please try again.",
      );
    }

    // Institution name, for a friendlier label. Non-fatal if it fails.
    let institutionName = "Bank";
    let institutionId: string | null = null;
    try {
      const itemResponse = await plaidClient.itemGet({ access_token: accessToken });
      institutionId = itemResponse.data.item.institution_id ?? null;
      if (institutionId) {
        const institution = await plaidClient.institutionsGetById({
          institution_id: institutionId,
          country_codes: [CountryCode.Us],
        });
        institutionName = institution.data.institution.name;
      }
    } catch {
      // non-fatal
    }

    let itemId: string;
    try {
      const stored = await upsertItemForUser({
        userId: ctx.user.id,
        plaidItemId,
        accessToken,
        institutionName,
        institutionId,
      });
      itemId = stored.id;
    } catch {
      // upsertItemForUser refuses to move an Item between tenants. The
      // requesting user learns nothing about the other account (§7).
      throw new HttpError(
        409,
        "item already owned",
        "That bank connection is already in use.",
      );
    }

    // Record the connection before syncing, so the audit trail is right even
    // if the first sync fails.
    await recordAudit({
      userId: ctx.user.id,
      type: "plaid.item.added",
      meta: { itemId, institutionId },
    });

    // First-connection housekeeping: mark onboarding complete.
    await prisma.user.update({
      where: { id: ctx.user.id },
      data: { onboardedAt: new Date() },
    });

    const result = await syncItemForUser(itemId, ctx.user.id);

    await sendSecurityNotice(ctx.user.email, "bank-connected");

    return safeJson({
      ok: true,
      institutionName,
      added: result.added,
      modified: result.modified,
      removed: result.removed,
    });
  },
);
