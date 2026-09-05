import { route, safeJson } from "@/lib/security/api";
import { getNudges } from "@/lib/nudges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route({ auth: "user", limits: ["read"] }, async (ctx) => {
  const nudges = await getNudges(ctx.user.id, ctx.user.timezone);
  return safeJson({ nudges });
});
