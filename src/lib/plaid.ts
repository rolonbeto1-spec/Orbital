import "server-only";
import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from "plaid";
import { env, plaidRedirectAllowlist } from "@/lib/env";

/**
 * Plaid client configuration.
 *
 * READ-ONLY, PERMANENTLY (§1). The product list below is the whole of Metta's
 * relationship with Plaid: `transactions`. There is no Auth product, no
 * Transfer, no Payment Initiation, no Signal — nothing that can move a cent.
 * Adding a money-movement product here is the one change this codebase must
 * never accept.
 *
 * The client is a module singleton so that serverless invocations reuse the
 * same keep-alive agent rather than opening a new TLS connection per request.
 */

export const plaidConfigured = Boolean(env.PLAID_CLIENT_ID && env.PLAID_SECRET);

/**
 * Where Plaid lives.
 *
 * Always the real Plaid host in production. The override is honoured only
 * outside production, so that the link/exchange/sync path can be driven
 * against a local stand-in during development; a variable able to redirect
 * bank credentials elsewhere must never be something a production
 * environment can switch on.
 */
function plaidBasePath(): string {
  const override = env.PLAID_API_BASE_URL;
  if (override && process.env.NODE_ENV !== "production") return override;
  return PlaidEnvironments[env.PLAID_ENV];
}

export const plaidClient: PlaidApi | null = plaidConfigured
  ? new PlaidApi(
      new Configuration({
        basePath: plaidBasePath(),
        baseOptions: {
          headers: {
            "PLAID-CLIENT-ID": env.PLAID_CLIENT_ID,
            "PLAID-SECRET": env.PLAID_SECRET,
          },
          // Bounded so a slow Plaid cannot pin a serverless function open.
          timeout: 25_000,
        },
      }),
    )
  : null;

/** Read-only products. Do not extend this list (§1, §82). */
export const PLAID_PRODUCTS = [Products.Transactions];
export const PLAID_COUNTRY_CODES = [CountryCode.Us];

/**
 * The OAuth redirect URI to hand Plaid.
 *
 * The browser never supplies this. It comes from an application-controlled
 * allowlist, so a crafted Link flow cannot redirect a user's bank
 * authorization to an attacker's page (§8, §19).
 */
export function plaidRedirectUri(): string | undefined {
  const allowed = plaidRedirectAllowlist();
  return allowed[0];
}

/** True if a redirect URI is one we published. Used when validating returns. */
export function isAllowedPlaidRedirect(candidate: string): boolean {
  return plaidRedirectAllowlist().includes(candidate);
}

/**
 * Item lifecycle states (§11).
 *
 * `connected` is the only state in which sync runs. Everything else means the
 * user must act (or has already disconnected), and the UI surfaces a repair
 * prompt rather than silently retrying forever.
 */
export const ITEM_STATUS = {
  CONNECTED: "connected",
  LOGIN_REQUIRED: "login_required",
  CONSENT_EXPIRED: "consent_expired",
  DISCONNECTED: "disconnected",
  REVOKED: "revoked",
  ERROR: "error",
} as const;

export type ItemStatus = (typeof ITEM_STATUS)[keyof typeof ITEM_STATUS];

/** Map a Plaid error code onto an Item status. */
export function itemStatusForPlaidError(errorCode: string | undefined): ItemStatus {
  switch (errorCode) {
    case "ITEM_LOGIN_REQUIRED":
    case "ITEM_LOCKED":
      return ITEM_STATUS.LOGIN_REQUIRED;
    case "PENDING_EXPIRATION":
    case "PENDING_DISCONNECT":
    case "USER_PERMISSION_REVOKED":
    case "USER_ACCOUNT_REVOKED":
      return ITEM_STATUS.CONSENT_EXPIRED;
    case "ITEM_NOT_FOUND":
    case "ACCESS_NOT_GRANTED":
      return ITEM_STATUS.REVOKED;
    case undefined:
      return ITEM_STATUS.CONNECTED;
    default:
      return ITEM_STATUS.ERROR;
  }
}

/**
 * Extract Plaid's own error code from a thrown SDK error, without letting the
 * rest of the response (which echoes the request, including the access token)
 * anywhere near a log line.
 */
export function plaidErrorCode(error: unknown): string | undefined {
  const data = (error as { response?: { data?: { error_code?: string } } })?.response?.data;
  return typeof data?.error_code === "string" ? data.error_code : undefined;
}

/**
 * A message safe to show a user. Plaid's error_message is written for
 * developers and can include identifiers; we map to our own copy instead.
 */
export function friendlyPlaidMessage(errorCode: string | undefined): string {
  switch (errorCode) {
    case "ITEM_LOGIN_REQUIRED":
      return "Your bank needs you to sign in again to keep sharing data.";
    case "PENDING_EXPIRATION":
    case "PENDING_DISCONNECT":
      return "Your bank connection is about to expire. Reconnect to keep it active.";
    case "USER_PERMISSION_REVOKED":
    case "USER_ACCOUNT_REVOKED":
      return "Access to this bank was revoked. Reconnect to restore it.";
    case "INSTITUTION_DOWN":
    case "INSTITUTION_NOT_RESPONDING":
      return "Your bank is not responding right now. We will try again later.";
    case "RATE_LIMIT_EXCEEDED":
      return "Too many requests to your bank right now. Try again shortly.";
    default:
      return "We could not reach your bank. We will try again later.";
  }
}
