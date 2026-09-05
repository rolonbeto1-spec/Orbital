import "server-only";
import type { Transaction as PlaidTransaction, AccountBase } from "plaid";
import type { MerchantRule } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { plaidClient, itemStatusForPlaidError, plaidErrorCode, ITEM_STATUS } from "@/lib/plaid";
import {
  accessTokenForOwnedItem,
  claimSyncSlot,
  releaseSyncSlot,
  setItemStatusById,
} from "@/lib/plaid-items";
import { getCategoryIdMap } from "@/lib/db-helpers";
import { mapPlaidCategory } from "@/lib/categories";
import { loadMerchantRules, resolveSmartCategory } from "@/lib/smart-categorize";
import { sanitizeDisplayUrl } from "@/lib/security/url-guard";
import { log, metric } from "@/lib/security/logger";
import { recordAudit } from "@/lib/security/audit";

/**
 * Plaid synchronisation, per user (§2, §8, §48).
 *
 * Every function here takes a userId. There is no `syncEverything()` that
 * walks all Items regardless of owner — the closest thing, syncAllItemsForUser,
 * is still scoped, and the webhook path resolves the owner from the Item
 * before it calls anything here.
 *
 * Concurrency: sync is claimed with a database lock (claimSyncSlot) because
 * serverless invocations are not serialised. A webhook, a pull-to-refresh and
 * a page load can all fire at the same instant; without the claim they would
 * duplicate work and race each other's cursor writes.
 */

export interface SyncResult {
  added: number;
  modified: number;
  removed: number;
  skipped?: "already-running" | "not-connected";
}

/** Bound on one sync run, so a huge or looping history cannot run forever. */
const MAX_SYNC_PAGES = 40;

async function syncAccounts(
  itemDbId: string,
  userId: string,
  accessToken: string,
): Promise<void> {
  if (!plaidClient) return;
  const response = await plaidClient.accountsGet({ access_token: accessToken });
  const accounts: AccountBase[] = response.data.accounts;

  for (const account of accounts) {
    const shared = {
      name: account.name,
      officialName: account.official_name ?? null,
      mask: account.mask ?? null,
      type: String(account.type),
      subtype: account.subtype ? String(account.subtype) : null,
      currentBalance: account.balances.current ?? 0,
      availableBalance: account.balances.available ?? null,
      currencyCode: account.balances.iso_currency_code ?? "USD",
    };

    // Upsert on the globally-unique Plaid account id, but write userId on
    // create so the row is owned from the moment it exists. `isBusiness` is
    // NOT in the update set: it is the user's own choice and must survive
    // every sync.
    await prisma.account.upsert({
      where: { plaidAccountId: account.account_id },
      create: {
        plaidAccountId: account.account_id,
        userId,
        itemId: itemDbId,
        ...shared,
      },
      update: shared,
    });
  }
}

async function upsertTransaction(
  transaction: PlaidTransaction,
  userId: string,
  categoryMap: Record<string, string>,
  rules: MerchantRule[],
): Promise<boolean> {
  // Scoped by userId: a Plaid account id is unique globally, but resolving it
  // through the tenant means a mis-routed webhook cannot write into another
  // user's account.
  const account = await prisma.account.findFirst({
    where: { plaidAccountId: transaction.account_id, userId },
    select: { id: true },
  });
  if (!account) return false; // account not synced yet, or not this user's

  const categoryName = mapPlaidCategory(
    transaction.personal_finance_category?.primary,
    transaction.personal_finance_category?.detailed,
  );
  let categoryId = categoryMap[categoryName] ?? null;

  // The user's own learned rules outrank Plaid's guess.
  const smart = resolveSmartCategory(
    transaction.merchant_name || transaction.name,
    transaction.amount,
    rules,
  );
  if (smart?.categoryId) categoryId = smart.categoryId;
  else if (smart?.categoryName && categoryMap[smart.categoryName]) {
    categoryId = categoryMap[smart.categoryName];
  }

  // Logo URLs come from Plaid but are rendered by the browser, so they are
  // validated as display URLs (https only, no javascript:/data:) before being
  // stored (§16, §20).
  const logoUrl = sanitizeDisplayUrl(
    transaction.counterparties?.[0]?.logo_url ??
      transaction.logo_url ??
      transaction.personal_finance_category_icon_url ??
      null,
  );

  const shared = {
    amount: transaction.amount,
    date: new Date(transaction.date),
    name: transaction.name,
    merchantName: transaction.merchant_name ?? null,
    logoUrl,
    pending: transaction.pending,
  };

  // The unique constraint on plaidTransactionId makes this idempotent: a
  // duplicate webhook delivery updates rather than inserting a second copy.
  await prisma.transaction.upsert({
    where: { plaidTransactionId: transaction.transaction_id },
    create: {
      plaidTransactionId: transaction.transaction_id,
      userId,
      accountId: account.id,
      categoryId,
      plaidCategory: transaction.personal_finance_category?.primary ?? null,
      currencyCode: transaction.iso_currency_code ?? "USD",
      ...shared,
    },
    // Deliberately does NOT overwrite categoryId, notes, folderId, owedBack
    // or reimbursedAmount: those are the user's work, and a re-sync must not
    // undo a manual recategorisation (§80, "the user's word is law").
    update: shared,
  });

  return true;
}

/**
 * Sync one Item that the caller has already established belongs to `userId`.
 */
export async function syncItemForUser(itemDbId: string, userId: string): Promise<SyncResult> {
  const empty: SyncResult = { added: 0, modified: 0, removed: 0 };
  if (!plaidClient) return empty;

  const item = await prisma.item.findFirst({
    where: { id: itemDbId, userId },
    select: { id: true, cursor: true, status: true },
  });
  if (!item) return empty; // not found, or not this user's — same outcome

  // Only a healthy connection syncs. A disconnected or revoked Item needs the
  // user to act; retrying it forever just burns Plaid quota (§11).
  if (item.status !== ITEM_STATUS.CONNECTED && item.status !== ITEM_STATUS.ERROR) {
    return { ...empty, skipped: "not-connected" };
  }

  const accessToken = await accessTokenForOwnedItem(itemDbId, userId);
  if (!accessToken) return empty;

  if (!(await claimSyncSlot(itemDbId))) {
    return { ...empty, skipped: "already-running" };
  }

  const started = Date.now();
  let added = 0;
  let modified = 0;
  let removed = 0;

  try {
    await syncAccounts(itemDbId, userId, accessToken);

    const categoryMap = await getCategoryIdMap(userId);
    const rules = await loadMerchantRules(userId);

    let cursor = item.cursor ?? undefined;
    let hasMore = true;
    let pages = 0;

    while (hasMore && pages < MAX_SYNC_PAGES) {
      pages++;
      const response = await plaidClient.transactionsSync({
        access_token: accessToken,
        cursor,
        count: 250,
      });
      const data = response.data;

      for (const transaction of data.added) {
        if (await upsertTransaction(transaction, userId, categoryMap, rules)) added++;
      }
      for (const transaction of data.modified) {
        if (await upsertTransaction(transaction, userId, categoryMap, rules)) modified++;
      }
      for (const gone of data.removed) {
        if (!gone.transaction_id) continue;
        // deleteMany scoped by userId: a removal notice can only ever delete
        // this tenant's row, never one that happens to share an id.
        const { count } = await prisma.transaction.deleteMany({
          where: { plaidTransactionId: gone.transaction_id, userId },
        });
        removed += count;
      }

      cursor = data.next_cursor;
      hasMore = data.has_more;

      // Persist the cursor after every page. If the function is killed
      // mid-sync, the next run resumes rather than re-reading from scratch.
      await prisma.item.update({ where: { id: itemDbId }, data: { cursor } });
    }

    await setItemStatusById(itemDbId, ITEM_STATUS.CONNECTED, null);
    await releaseSyncSlot(itemDbId, null);

    metric("plaid.sync.duration_ms", Date.now() - started, { outcome: "ok" });
    metric("plaid.sync.transactions", added + modified, {});

    // AI passes run after the data lands, scoped to this user. They exit for
    // free when there is nothing to do or no API key.
    const { aiSortNewTransactions, aiAuditTransactions, aiIdentifyLogos } = await import(
      "@/lib/ai-categorize"
    );
    await aiSortNewTransactions(userId);
    await aiAuditTransactions(userId);
    await aiIdentifyLogos(userId);

    return { added, modified, removed };
  } catch (error) {
    const code = plaidErrorCode(error);
    const status = itemStatusForPlaidError(code);

    // Record the *code*, never the error body — Plaid's error responses echo
    // the request, which contains the access token (§9, §12).
    await setItemStatusById(itemDbId, status, code ?? null);
    await releaseSyncSlot(itemDbId, code ?? "sync_failed");

    metric("plaid.sync.duration_ms", Date.now() - started, { outcome: "error" });
    metric("plaid.sync.error", 1, { code: code ?? "unknown" });
    log.warn("Plaid sync failed", { itemId: itemDbId, code });
    await recordAudit({
      userId,
      type: "plaid.sync_failed",
      outcome: "failure",
      meta: { itemId: itemDbId, code },
    });

    return empty;
  }
}

/** Sync every connected Item belonging to one user. */
export async function syncAllItemsForUser(userId: string): Promise<SyncResult> {
  const items = await prisma.item.findMany({
    where: { userId, status: { in: [ITEM_STATUS.CONNECTED, ITEM_STATUS.ERROR] } },
    select: { id: true },
  });

  const total: SyncResult = { added: 0, modified: 0, removed: 0 };
  for (const item of items) {
    const result = await syncItemForUser(item.id, userId);
    total.added += result.added;
    total.modified += result.modified;
    total.removed += result.removed;
  }
  return total;
}
