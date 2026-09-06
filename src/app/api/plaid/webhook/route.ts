import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPlaidWebhook } from "@/lib/plaid-webhook-verify";
import { resolveItemByPlaidId, setItemStatusById } from "@/lib/plaid-items";
import { syncItemForUser } from "@/lib/sync";
import { ITEM_STATUS, itemStatusForPlaidError } from "@/lib/plaid";
import { fingerprint } from "@/lib/security/crypto";
import { consumeRateLimit, clientIp } from "@/lib/security/rate-limit";
import { recordAudit } from "@/lib/security/audit";
import { log, metric } from "@/lib/security/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Plaid webhook receiver (§10).
 *
 * This is the one unauthenticated write endpoint in the application, so every
 * property it needs is established rather than assumed:
 *
 *  - AUTHENTICITY: the ES256 signature over a digest of the exact request
 *    bytes is verified before the body is parsed. An unverified request is
 *    rejected outright — not the source IP, not a secret URL, the signature.
 *  - TENANCY: the body names a Plaid item. The owning user is looked up in
 *    our database. Nothing in the body is trusted to say who the user is,
 *    and there is no field we would believe if it did.
 *  - IDEMPOTENCY: each delivery is fingerprinted and recorded. A duplicate or
 *    replayed delivery is acknowledged and dropped.
 *  - ACKNOWLEDGEMENT: Plaid retries on non-2xx. We return 200 for anything we
 *    have decided not to act on (unknown item, duplicate) so it is not
 *    retried forever, and reserve non-2xx for "we failed, try again".
 */
export async function POST(request: Request): Promise<Response> {
  // A blunt limit in front of an unauthenticated endpoint. Generous, because
  // a real Plaid burst after an outage is legitimate traffic.
  const limit = await consumeRateLimit("webhook", `ip:${clientIp(request)}`);
  if (!limit.ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  // Read the raw bytes. Re-serialising parsed JSON would change the digest
  // and break verification.
  const rawBody = await request.text();
  if (rawBody.length > 256 * 1024) {
    return NextResponse.json({ error: "Body too large" }, { status: 413 });
  }

  const verification = await verifyPlaidWebhook(
    request.headers.get("plaid-verification"),
    rawBody,
  );
  if (!verification.ok) {
    metric("plaid.webhook.rejected", 1, { reason: verification.reason ?? "unknown" });
    await recordAudit({
      type: "plaid.webhook.rejected",
      outcome: "denied",
      ip: clientIp(request),
      meta: { reason: verification.reason },
    });
    // 401 without detail. An attacker probing the endpoint learns only that
    // it did not accept the request.
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: {
    webhook_type?: string;
    webhook_code?: string;
    item_id?: string;
    error?: { error_code?: string };
    new_transactions?: number;
    removed_transactions?: string[];
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const webhookType = String(payload.webhook_type ?? "");
  const webhookCode = String(payload.webhook_code ?? "");
  const plaidItemId = typeof payload.item_id === "string" ? payload.item_id : "";

  if (!plaidItemId) {
    // Nothing to route. Acknowledge so Plaid stops retrying.
    return NextResponse.json({ received: true });
  }

  // --- Idempotency ------------------------------------------------------
  // The fingerprint covers the whole body, so a genuine second event of the
  // same type is still processed while an exact replay is not.
  const deliveryFingerprint = fingerprint(webhookType, webhookCode, plaidItemId, rawBody);
  try {
    await prisma.webhookDelivery.create({
      data: { fingerprint: deliveryFingerprint, itemId: plaidItemId },
    });
  } catch {
    // Unique constraint violation: we have already handled this exact
    // delivery. Acknowledge and stop (§10 replay-safe).
    metric("plaid.webhook.duplicate", 1, { type: webhookType });
    return NextResponse.json({ received: true, duplicate: true });
  }

  // --- Tenancy ----------------------------------------------------------
  const item = await resolveItemByPlaidId(plaidItemId);
  if (!item) {
    // An Item we do not know about — most often one the user just
    // disconnected. Acknowledge; there is nothing to do.
    metric("plaid.webhook.unknown_item", 1, { type: webhookType });
    return NextResponse.json({ received: true });
  }

  metric("plaid.webhook.received", 1, { type: webhookType, code: webhookCode });

  try {
    switch (webhookType) {
      case "TRANSACTIONS": {
        // SYNC_UPDATES_AVAILABLE is the modern signal; the others are legacy
        // but still delivered by some institutions.
        if (
          webhookCode === "SYNC_UPDATES_AVAILABLE" ||
          webhookCode === "DEFAULT_UPDATE" ||
          webhookCode === "INITIAL_UPDATE" ||
          webhookCode === "HISTORICAL_UPDATE" ||
          webhookCode === "TRANSACTIONS_REMOVED"
        ) {
          // Owner resolved from our own database, never from the payload.
          await syncItemForUser(item.id, item.userId);
        }
        break;
      }

      case "ITEM": {
        if (webhookCode === "ERROR") {
          const status = itemStatusForPlaidError(payload.error?.error_code);
          await setItemStatusById(item.id, item.userId, status, payload.error?.error_code ?? null);
          await recordAudit({
            userId: item.userId,
            type: "plaid.item.error",
            outcome: "failure",
            meta: { itemId: item.id, code: payload.error?.error_code },
          });
        } else if (webhookCode === "PENDING_EXPIRATION" || webhookCode === "PENDING_DISCONNECT") {
          await setItemStatusById(item.id, item.userId, ITEM_STATUS.CONSENT_EXPIRED, webhookCode);
        } else if (webhookCode === "USER_PERMISSION_REVOKED" || webhookCode === "USER_ACCOUNT_REVOKED") {
          await setItemStatusById(item.id, item.userId, ITEM_STATUS.REVOKED, webhookCode);
          await recordAudit({
            userId: item.userId,
            type: "plaid.item.revoked",
            meta: { itemId: item.id },
          });
        } else if (webhookCode === "LOGIN_REPAIRED" || webhookCode === "NEW_ACCOUNTS_AVAILABLE") {
          await setItemStatusById(item.id, item.userId, ITEM_STATUS.CONNECTED, null);
        }
        break;
      }

      default:
        // Any other product's webhooks are not ours to act on. Metta only
        // subscribes to transactions (§1).
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    // A processing failure is worth a retry from Plaid, so return 500 — but
    // release the idempotency record first, or the retry would be dropped as
    // a duplicate.
    await prisma.webhookDelivery
      .delete({ where: { fingerprint: deliveryFingerprint } })
      .catch(() => undefined);
    log.error("Plaid webhook processing failed", { type: webhookType, code: webhookCode, error });
    metric("plaid.webhook.failed", 1, { type: webhookType });
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}

/**
 * Plaid only ever POSTs. Answering GET with 405 makes it obvious this is not
 * a state-changing GET endpoint (§17).
 */
export function GET(): Response {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
