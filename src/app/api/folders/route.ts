import { route, safeJson, HttpError } from "@/lib/security/api";
import { prisma } from "@/lib/prisma";
import { folderCreate } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route({ auth: "user", limits: ["read"] }, async (ctx) => {
  const folders = await prisma.folder.findMany({
    where: { userId: ctx.user.id },
    select: {
      id: true,
      name: true,
      createdAt: true,
      _count: { select: { transactions: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return safeJson({ folders });
});

/**
 * Create a bookkeeping folder.
 *
 * Names are unique per user, not globally: two people can both have a folder
 * called "Taxes 2026" without colliding, and neither can discover the other's
 * folder names by trying to create one (§6).
 */
export const POST = route(
  { auth: "user", limits: ["write"], body: folderCreate },
  async (ctx) => {
    const count = await prisma.folder.count({ where: { userId: ctx.user.id } });
    if (count >= 200) throw new HttpError(400, "too many folders", "You have too many folders.");

    const folder = await prisma.folder.upsert({
      where: { userId_name: { userId: ctx.user.id, name: ctx.body.name } },
      update: {},
      create: { userId: ctx.user.id, name: ctx.body.name },
      select: { id: true, name: true, createdAt: true },
    });
    return safeJson(folder);
  },
);
