import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Per-user reference data helpers.
 *
 * The old versions of these functions were global: `ensureCategories()` made
 * one shared catalog, and `ensureDemoData()` seeded demo transactions into an
 * empty database. Both are gone.
 *
 * Categories are now provisioned per user at signup (see
 * src/lib/account-lifecycle.ts). Demo seeding does not exist in the
 * application at all (§47) — a new account with no bank connected sees a
 * genuine empty state. The seed script remains available for local
 * development only, and writes to an explicitly named local user.
 */

/**
 * name -> category id, for one user.
 *
 * Every caller must pass a userId. There is deliberately no default and no
 * "current user" lookup inside this function: making the tenant an explicit
 * argument means a missing scope is a TypeScript error rather than a silent
 * cross-tenant read.
 */
export async function getCategoryIdMap(userId: string): Promise<Record<string, string>> {
  const categories = await prisma.category.findMany({
    where: { userId },
    select: { id: true, name: true },
  });
  const map: Record<string, string> = {};
  for (const category of categories) map[category.name] = category.id;
  return map;
}

/** id -> category, for one user. */
export async function getCategoriesById(userId: string) {
  const categories = await prisma.category.findMany({ where: { userId } });
  return new Map(categories.map((category) => [category.id, category]));
}

/** All of one user's categories, in catalog order. */
export async function listCategories(userId: string) {
  return prisma.category.findMany({
    where: { userId },
    orderBy: { name: "asc" },
  });
}

/**
 * Read one of a user's settings.
 *
 * Settings are keyed by (userId, key). There are no global keys, so the
 * collisions the single-tenant version had — one `digestLast`, one
 * `aiCalls:2026-09-05` shared by everybody — cannot happen (§6).
 */
export async function getSetting(userId: string, key: string): Promise<string | null> {
  const setting = await prisma.setting.findUnique({
    where: { userId_key: { userId, key } },
    select: { value: true },
  });
  return setting?.value ?? null;
}

export async function setSetting(userId: string, key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { userId_key: { userId, key } },
    create: { userId, key, value },
    update: { value },
  });
}

export async function deleteSetting(userId: string, key: string): Promise<void> {
  await prisma.setting
    .delete({ where: { userId_key: { userId, key } } })
    .catch(() => undefined); // absent is fine
}

/** JSON-valued setting, with a safe fallback when absent or corrupt. */
export async function getJsonSetting<T>(
  userId: string,
  key: string,
  fallback: T,
): Promise<T> {
  const raw = await getSetting(userId, key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function setJsonSetting(
  userId: string,
  key: string,
  value: unknown,
): Promise<void> {
  // Bounded so a settings row cannot be used as unlimited storage.
  const serialized = JSON.stringify(value);
  if (serialized.length > 64_000) {
    throw new Error("Setting value is too large");
  }
  await setSetting(userId, key, serialized);
}
