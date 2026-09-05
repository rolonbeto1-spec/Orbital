import { route, safeJson } from "@/lib/security/api";
import { prisma } from "@/lib/prisma";
import { requireOwned, assertOwned, resolveOwnedRef } from "@/lib/security/ownership";
import { transactionUpdate } from "@/lib/validation";
import { learnFromCorrection } from "@/lib/smart-categorize";
import { roundMoney } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Edit one transaction: recategorise, note, reimbursement, folder.
 *
 * Every id in this request is checked against the caller's tenancy before it
 * is used (§7):
 *   - the transaction itself, via requireOwned;
 *   - the target category, via assertOwned — otherwise a user could file
 *     their transaction under another tenant's category row;
 *   - the target folder, via resolveOwnedRef — otherwise "move my transaction
 *     into your folder" would link two tenants' data together.
 *
 * PATCH, never GET: this mutates (§17).
 */
export const PATCH = route(
  { auth: "user", limits: ["write"], body: transactionUpdate },
  async (ctx) => {
    const id = ctx.params.id;

    // 404 for both "no such transaction" and "not yours".
    const before = await requireOwned<{
      id: string;
      categoryId: string | null;
      amount: number;
      name: string;
      merchantName: string | null;
    }>("transaction", id, ctx.user.id, {
      select: { id: true, categoryId: true, amount: true, name: true, merchantName: true },
    });

    const data: {
      categoryId?: string | null;
      notes?: string | null;
      folderId?: string | null;
      owedBack?: boolean;
      reimbursedAmount?: number;
    } = {};

    if ("categoryId" in ctx.body) {
      if (ctx.body.categoryId) {
        await assertOwned("category", ctx.body.categoryId, ctx.user.id);
        data.categoryId = ctx.body.categoryId;
      } else {
        data.categoryId = null;
      }
    }

    if ("notes" in ctx.body) data.notes = ctx.body.notes ?? null;

    if ("folderId" in ctx.body) {
      data.folderId = await resolveOwnedRef("folder", ctx.body.folderId, ctx.user.id);
    }

    // folderName: create-or-reuse one of THIS user's folders. The unique
    // constraint is (userId, name), so this can never attach the transaction
    // to another tenant's folder of the same name (§6).
    if (ctx.body.folderName) {
      const name = ctx.body.folderName.trim();
      const folder = await prisma.folder.upsert({
        where: { userId_name: { userId: ctx.user.id, name } },
        update: {},
        create: { userId: ctx.user.id, name },
        select: { id: true },
      });
      data.folderId = folder.id;
    }

    if ("owedBack" in ctx.body) data.owedBack = Boolean(ctx.body.owedBack);

    if (ctx.body.reimbursedAmount !== undefined) {
      // Never reimburse more than was spent; rounded to the cent (§49).
      const cap = before.amount > 0 ? before.amount : 0;
      data.reimbursedAmount = roundMoney(Math.min(Math.max(0, ctx.body.reimbursedAmount), cap));
    }

    // updateMany with the tenancy in the WHERE clause. Even though ownership
    // was just established, the write itself stays scoped — defence in depth
    // against a future refactor that drops the check above.
    await prisma.transaction.updateMany({
      where: { id, userId: ctx.user.id },
      data,
    });

    const updated = await prisma.transaction.findFirst({
      where: { id, userId: ctx.user.id },
      select: {
        id: true,
        amount: true,
        date: true,
        name: true,
        merchantName: true,
        categoryId: true,
        logoUrl: true,
        pending: true,
        notes: true,
        owedBack: true,
        reimbursedAmount: true,
        folderId: true,
        category: { select: { id: true, name: true, icon: true, color: true, group: true } },
        folder: { select: { id: true, name: true } },
        account: { select: { name: true, mask: true } },
      },
    });

    // A manual category change on a spend teaches this user's categoriser.
    // The lesson is written into their own rule set only.
    if (
      updated &&
      data.categoryId &&
      data.categoryId !== before.categoryId &&
      updated.amount > 0
    ) {
      await learnFromCorrection(
        ctx.user.id,
        updated.merchantName || updated.name,
        data.categoryId,
        updated.amount,
      );
    }

    return safeJson(updated);
  },
);
