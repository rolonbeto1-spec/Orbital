import { z } from "zod";
import { CountryCode } from "plaid";
import { route, safeJson, HttpError } from "@/lib/security/api";
import {
  plaidClient,
  plaidConfigured,
  PLAID_PRODUCTS,
  plaidRedirectUri,
  plaidErrorCode,
} from "@/lib/plaid";
import { env } from "@/lib/env";
import { requireOwned } from "@/lib/security/ownership";
import { accessTokenForOwnedItem } from "@/lib/plaid-items";
import { log } from "@/lib/security/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z
  .object({
    // Present when repairing an existing connection (update mode). The id is
    // ownership-checked below — a user can only repair their own Item (§11).
    itemId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
  })
  .strict();

/**
 * Create a Plaid Link token for the signed-in user (§8).
 *
 * The `client_user_id` is the user's opaque `plaidUserRef`, never their email,
 * name or phone number. The redirect URI comes from an application-controlled
 * allowlist, never from the request.
 *
 * POST only: creating a link token is a state-changing, quota-consuming
 * operation and must not be reachable by a cross-site GET (§17).
 */
export const POST = route({ auth: "user", limits: ["plaidLinkToken"], body }, async (ctx) => {
  if (!plaidConfigured || !plaidClient) {
    throw new HttpError(503, "Plaid not configured", "Bank connections are not available yet.");
  }

  // Update mode: repairing a connection the user actually owns.
  let accessToken: string | undefined;
  if (ctx.body.itemId) {
    await requireOwned("item", ctx.body.itemId, ctx.user.id, { select: { id: true } });
    accessToken = (await accessTokenForOwnedItem(ctx.body.itemId, ctx.user.id)) ?? undefined;
  }

  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: ctx.user.plaidUserRef },
      client_name: "Metta",
      language: "en",
      country_codes: [CountryCode.Us],
      // In update mode Plaid rejects a products list; the Item keeps its own.
      ...(accessToken
        ? { access_token: accessToken }
        : { products: PLAID_PRODUCTS }),
      ...(plaidRedirectUri() ? { redirect_uri: plaidRedirectUri() } : {}),
      ...(env.PLAID_WEBHOOK_URL ? { webhook: env.PLAID_WEBHOOK_URL } : {}),
    });

    // Only the link token goes back. It is short-lived, single-use and scoped
    // to this user by Plaid; the *access* token never leaves the server (§9).
    return safeJson({ link_token: response.data.link_token });
  } catch (error) {
    // Plaid's error body echoes the request, including any access token, so
    // only the code is logged and nothing from it is returned (§9, §40).
    const code = plaidErrorCode(error);
    log.error("Plaid link token creation failed", { code });
    throw new HttpError(502, `plaid:${code ?? "unknown"}`, "Could not start the bank connection. Please try again.");
  }
});
