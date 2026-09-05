import { route, safeJson } from "@/lib/security/api";
import { detectRecurring } from "@/lib/recurring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Recurring-charge detection.
 *
 * Rate-limited on its own budget because it is one of the more expensive
 * reads in the app: it scans six months of the user's transactions and does
 * cadence analysis over them (§22, §72).
 */
export const GET = route({ auth: "user", limits: ["recurring"] }, async (ctx) => {
  const recurring = await detectRecurring(ctx.user.id);
  return safeJson({ recurring });
});
