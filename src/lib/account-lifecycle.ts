import "server-only";
import { prisma } from "@/lib/prisma";
import { CATEGORIES } from "@/lib/categories";
import { decryptSecret } from "@/lib/security/crypto";
import { log } from "@/lib/security/logger";
import { recordAudit } from "@/lib/security/audit";

/**
 * Account lifecycle: provisioning and deletion (§37, §47, §69).
 *
 * These two functions bracket a user's existence. Provisioning gives a new
 * account exactly the private reference data it needs — and nothing that
 * belongs to anyone else. Deletion removes the money.
 */

/**
 * Set up a brand-new account.
 *
 * Each user gets their own copy of the category catalog. That is deliberate:
 * categories carry a per-user `inBudget` override and are the target of
 * per-user budgets and merchant rules, so a shared global catalog would be a
 * place where one tenant's preference changed another tenant's budget.
 *
 * Note what is NOT here: no demo data, ever (§47). A new account with no bank
 * connected sees a genuine empty state, not seeded transactions that look
 * like their money.
 */
export async function provisionNewUser(userId: string): Promise<void> {
  const existing = await prisma.category.count({ where: { userId } });
  if (existing > 0) return; // idempotent: safe if a retry runs it twice

  await prisma.category.createMany({
    data: CATEGORIES.map((category) => ({
      userId,
      name: category.name,
      icon: category.icon,
      color: category.color,
      group: category.group,
    })),
  });

  log.info("Provisioned new account");
}

/**
 * Destroy everything a user's account holds, before the User row itself goes.
 *
 * Order matters:
 *  1. revoke bank access at Plaid *first*, while we can still decrypt the
 *     credentials — once the rows are gone we could not tell Plaid to stop;
 *  2. then delete the local data.
 *
 * Cascade deletes on the User foreign key would remove most of this
 * automatically, but doing it explicitly means the behaviour is visible,
 * testable, and does not silently change if a relation's onDelete is edited.
 *
 * What deliberately survives deletion, and why:
 *  - AuditEvent rows, with their userId set to NULL. They contain no
 *    financial data, and destroying the record that an account was deleted
 *    would make the audit trail useless exactly when it matters. Documented
 *    in SECURITY_REVIEW.md and the Privacy Policy.
 *  - Rate-limit counters, which are keyed by an irreversible hash and expire
 *    on their own within the hour.
 */
export async function purgeUserData(userId: string): Promise<void> {
  // --- 1. Revoke third-party access -------------------------------------
  const items = await prisma.item.findMany({
    where: { userId },
    select: { id: true, accessTokenCipher: true, plaidItemId: true },
  });

  if (items.length > 0) {
    // Imported lazily so that deleting an account works even in a deployment
    // with no Plaid credentials configured.
    const { plaidClient } = await import("@/lib/plaid");
    for (const item of items) {
      if (!plaidClient) break;
      try {
        const accessToken = decryptSecret(item.accessTokenCipher);
        await plaidClient.itemRemove({ access_token: accessToken });
      } catch (error) {
        // Best effort. A failure here must not block the user's deletion —
        // but it must be recorded, because it means a connection may still
        // exist at Plaid and needs manual cleanup (INCIDENT_RESPONSE.md).
        log.error("Could not revoke Plaid item during account deletion", {
          itemId: item.id,
          error,
        });
        await recordAudit({
          userId,
          type: "plaid.revoke_failed_on_delete",
          outcome: "failure",
          meta: { itemId: item.id },
        });
      }
    }
  }

  // --- 2. Delete local data ---------------------------------------------
  // Explicit, ordered, and inside a transaction so a partial delete cannot
  // leave financial rows orphaned from their owner.
  await prisma.$transaction([
    prisma.transaction.deleteMany({ where: { userId } }),
    prisma.holding.deleteMany({ where: { userId } }),
    prisma.account.deleteMany({ where: { userId } }),
    prisma.item.deleteMany({ where: { userId } }),
    prisma.budget.deleteMany({ where: { userId } }),
    prisma.merchantRule.deleteMany({ where: { userId } }),
    prisma.category.deleteMany({ where: { userId } }),
    prisma.folder.deleteMany({ where: { userId } }),
    prisma.goal.deleteMany({ where: { userId } }),
    prisma.property.deleteMany({ where: { userId } }),
    // Settings hold the AI caches, digest timers and hive layout.
    prisma.setting.deleteMany({ where: { userId } }),
    // Every session is invalidated immediately.
    prisma.session.deleteMany({ where: { userId } }),
  ]);

  await recordAudit({
    userId,
    type: "account.data_purged",
    meta: { items: items.length },
  });

  log.info("Purged account data", { items: items.length });
}

/**
 * Mark an account as deleted without removing it yet.
 *
 * requireUser() refuses a user with deletedAt set, so this takes effect
 * immediately for every request while the deletion drains.
 */
export async function markUserDeleted(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });
  await prisma.session.deleteMany({ where: { userId } });
}
