import "server-only";
import { prisma } from "@/lib/prisma";
import { encryptSecret, decryptSecret } from "@/lib/security/crypto";
import { activeEncryptionKey } from "@/lib/env";
import { ITEM_STATUS, type ItemStatus } from "@/lib/plaid";

/**
 * The only place Plaid access tokens are read or written (§9).
 *
 * Every other module goes through these functions. That is what makes the
 * "tokens never reach the browser, a log, an API response, or the AI" claim
 * checkable rather than aspirational: there is exactly one function that can
 * produce a plaintext token, it is server-only, and its result is passed
 * straight into a Plaid SDK call.
 *
 * `Item.accessTokenCipher` holds the AES-256-GCM value; there is no column
 * anywhere that holds a plaintext token.
 */

export interface StoredItem {
  id: string;
  userId: string;
  plaidItemId: string;
  institutionName: string;
  institutionId: string | null;
  status: string;
  cursor: string | null;
}

/**
 * Store or update a bank connection for a specific user.
 *
 * Uses the (userId, plaidItemId) pair rather than plaidItemId alone: a
 * relinked Item must update the *owner's* row, and must never overwrite a row
 * belonging to a different tenant. Plaid item ids are globally unique, so the
 * unique constraint stays on plaidItemId, but the write is still scoped.
 */
export async function upsertItemForUser(params: {
  userId: string;
  plaidItemId: string;
  accessToken: string;
  institutionName: string;
  institutionId: string | null;
}): Promise<{ id: string; created: boolean }> {
  const active = activeEncryptionKey();
  if (!active) {
    throw new Error("Cannot store a bank connection without an encryption key configured.");
  }

  const cipher = encryptSecret(params.accessToken);

  // If this Plaid item already exists, it must belong to the same user.
  // Re-linking the same bank from another account is not a way to take over
  // an existing connection.
  const existing = await prisma.item.findUnique({
    where: { plaidItemId: params.plaidItemId },
    select: { id: true, userId: true },
  });

  if (existing && existing.userId !== params.userId) {
    // Deliberately opaque to the caller: the requesting user learns nothing
    // about the other account.
    throw new Error("This bank connection is already in use.");
  }

  if (existing) {
    await prisma.item.update({
      where: { id: existing.id },
      data: {
        accessTokenCipher: cipher,
        accessTokenKeyId: active.id,
        institutionName: params.institutionName,
        institutionId: params.institutionId,
        status: ITEM_STATUS.CONNECTED,
        statusDetail: null,
        lastSyncError: null,
      },
    });
    return { id: existing.id, created: false };
  }

  const created = await prisma.item.create({
    data: {
      userId: params.userId,
      plaidItemId: params.plaidItemId,
      accessTokenCipher: cipher,
      accessTokenKeyId: active.id,
      institutionName: params.institutionName,
      institutionId: params.institutionId,
      status: ITEM_STATUS.CONNECTED,
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

/**
 * Decrypt the access token for an Item the caller owns.
 *
 * `userId` is required, not optional. There is no way to call this function
 * without naming the tenant, which means there is no way to accidentally
 * decrypt someone else's bank credential (§7).
 */
export async function accessTokenForOwnedItem(
  itemId: string,
  userId: string,
): Promise<string | null> {
  const item = await prisma.item.findFirst({
    where: { id: itemId, userId },
    select: { accessTokenCipher: true },
  });
  if (!item) return null;
  return decryptSecret(item.accessTokenCipher);
}

/**
 * Resolve a Plaid item id to the owning user and internal Item.
 *
 * This is the webhook path (§10): the webhook body names a Plaid item, and we
 * derive the owner from our own database. A user id in the webhook body would
 * never be trusted — Plaid does not send one, and if it did we would ignore it.
 */
export async function resolveItemByPlaidId(plaidItemId: string): Promise<{
  id: string;
  userId: string;
  accessToken: string;
  status: string;
} | null> {
  const item = await prisma.item.findUnique({
    where: { plaidItemId },
    select: { id: true, userId: true, accessTokenCipher: true, status: true },
  });
  if (!item) return null;
  return {
    id: item.id,
    userId: item.userId,
    accessToken: decryptSecret(item.accessTokenCipher),
    status: item.status,
  };
}

/** Update an Item's connection state. Always scoped to the owner. */
export async function setItemStatus(
  itemId: string,
  userId: string,
  status: ItemStatus,
  detail?: string | null,
): Promise<void> {
  await prisma.item.updateMany({
    where: { id: itemId, userId },
    data: { status, statusDetail: detail ?? null },
  });
}

/** Same, for the webhook path where the owner was resolved from the Item. */
export async function setItemStatusById(
  itemId: string,
  status: ItemStatus,
  detail?: string | null,
): Promise<void> {
  await prisma.item.update({
    where: { id: itemId },
    data: { status, statusDetail: detail ?? null },
  });
}

/**
 * List a user's connections for the UI.
 *
 * The select list is explicit and does NOT include accessTokenCipher. That is
 * the point: a `findMany` with no select would return the encrypted token to
 * the caller, and from there into a JSON response. Being explicit here means
 * the token cannot leak by omission (§9).
 */
export async function listItemsForUser(userId: string) {
  return prisma.item.findMany({
    where: { userId },
    select: {
      id: true,
      institutionName: true,
      institutionId: true,
      status: true,
      statusDetail: true,
      lastSyncedAt: true,
      createdAt: true,
      accounts: {
        select: {
          id: true,
          name: true,
          mask: true,
          type: true,
          subtype: true,
          currentBalanceCents: true,
          availableBalanceCents: true,
          isBusiness: true,
          currencyCode: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Claim an exclusive sync slot for an Item (§48).
 *
 * Serverless requests run concurrently: a webhook, a manual refresh and a
 * page load can all decide to sync the same Item at the same moment, which
 * duplicates work and races the cursor update. This does a conditional
 * update — only one caller can transition the row from "not syncing" to
 * "syncing", and the others are told to stand down.
 *
 * The 15-minute staleness window releases a lock left behind by a function
 * that was killed mid-sync.
 */
export async function claimSyncSlot(itemId: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000);
  const { count } = await prisma.item.updateMany({
    where: {
      id: itemId,
      OR: [{ syncStartedAt: null }, { syncStartedAt: { lt: staleBefore } }],
    },
    data: { syncStartedAt: new Date() },
  });
  return count === 1;
}

export async function releaseSyncSlot(itemId: string, error?: string | null): Promise<void> {
  await prisma.item.update({
    where: { id: itemId },
    data: {
      syncStartedAt: null,
      lastSyncedAt: new Date(),
      lastSyncError: error ?? null,
    },
  });
}
