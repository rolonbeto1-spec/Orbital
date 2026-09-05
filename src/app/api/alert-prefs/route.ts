import { route, safeJson } from "@/lib/security/api";
import { getAlertPrefs, setAlertPrefs } from "@/lib/alert-prefs";
import { alertPrefsUpdate } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route({ auth: "user", limits: ["read"] }, async (ctx) => {
  return safeJson(await getAlertPrefs(ctx.user.id));
});

/**
 * POST, not GET: changing a preference is a mutation and must not be
 * triggerable by a cross-site request (§17).
 */
export const POST = route(
  { auth: "user", limits: ["write"], body: alertPrefsUpdate },
  async (ctx) => {
    const prefs = await setAlertPrefs(ctx.user.id, {
      half: ctx.body.budgetOverrun,
      full: ctx.body.budgetOverrun,
      weekly: ctx.body.weeklyDigest,
    });
    return safeJson(prefs);
  },
);
