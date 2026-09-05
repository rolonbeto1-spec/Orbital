import { route, safeJson } from "@/lib/security/api";
import { getJsonSetting, setJsonSetting } from "@/lib/db-helpers";
import { hiveLayoutUpdate } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY = "hiveLayout";

/**
 * The user's dragged hive arrangement.
 *
 * Stored per user in the (userId, key) Setting table. The schema bounds both
 * the number of cells and the coordinate range, so this endpoint cannot be
 * used as arbitrary storage (§14).
 */
export const GET = route({ auth: "user", limits: ["read"] }, async (ctx) => {
  const layout = await getJsonSetting<Record<string, { x: number; y: number }>>(
    ctx.user.id,
    KEY,
    {},
  );
  return safeJson({ layout });
});

export const POST = route(
  { auth: "user", limits: ["write"], body: hiveLayoutUpdate },
  async (ctx) => {
    await setJsonSetting(ctx.user.id, KEY, ctx.body.layout);
    return safeJson({ ok: true });
  },
);
