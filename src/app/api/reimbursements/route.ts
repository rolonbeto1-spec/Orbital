import { route, safeJson } from "@/lib/security/api";
import { getReimbursements } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route({ auth: "user", limits: ["read"] }, async (ctx) => {
  return safeJson(await getReimbursements(ctx.user.id));
});
