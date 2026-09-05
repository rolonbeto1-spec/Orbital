import { route, safeJson } from "@/lib/security/api";
import { prisma } from "@/lib/prisma";
import { requireOwned } from "@/lib/security/ownership";
import { folderCreate } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const PATCH = route(
  { auth: "user", limits: ["write"], body: folderCreate },
  async (ctx) => {
    const id = ctx.params.id;
    await requireOwned("folder", id, ctx.user.id, { select: { id: true } });
    await prisma.folder.updateMany({
      where: { id, userId: ctx.user.id },
      data: { name: ctx.body.name },
    });
    const folder = await prisma.folder.findFirst({
      where: { id, userId: ctx.user.id },
      select: { id: true, name: true },
    });
    return safeJson(folder);
  },
);

/**
 * Delete a folder. Transactions filed in it are NOT deleted — the relation is
 * onDelete: SetNull, so the charges survive and simply become unfiled. That
 * is a deliberate retention choice: deleting a bookkeeping label must not
 * destroy financial history (§67).
 */
export const DELETE = route({ auth: "user", limits: ["write"] }, async (ctx) => {
  const id = ctx.params.id;
  await requireOwned("folder", id, ctx.user.id, { select: { id: true } });
  await prisma.folder.deleteMany({ where: { id, userId: ctx.user.id } });
  return safeJson({ ok: true });
});
