import { route, safeJson } from "@/lib/security/api";
import { listCategories } from "@/lib/db-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The user's own category catalog.
 *
 * Categories are per-user rows (seeded at signup), not a shared global table,
 * so this list and the ids in it are scoped like everything else (§6).
 */
export const GET = route({ auth: "user", limits: ["read"] }, async (ctx) => {
  const categories = await listCategories(ctx.user.id);
  return safeJson({ categories });
});
