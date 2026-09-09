import { route, safeJson } from "@/lib/security/api";
import { getReimbursements } from "@/lib/queries";
import { serializeMoneyFields } from "@/lib/money";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route({ auth: "user", limits: ["read"] }, async (ctx) => {
  // Cents -> dollars at the boundary (§49). Without this the response carried
  // `totalOwedCents` while the banner read `totalOwed`, so the "you are owed"
  // card rendered "$NaN" — or, because the guard compares that value to zero,
  // never rendered at all.
  return safeJson(serializeMoneyFields(await getReimbursements(ctx.user.id)));
});
