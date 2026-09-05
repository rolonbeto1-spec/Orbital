import { route, safeJson } from "@/lib/security/api";
import { listAuditEvents } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The user's own security history: sign-ins, password changes, bank
 * connections (§41, §70).
 *
 * Read-only and scoped. There is no route anywhere that lets a user read,
 * edit or delete another account's events, or their own.
 */
export const GET = route({ auth: "user", limits: ["read"] }, async (ctx) => {
  const events = await listAuditEvents(ctx.user.id, 50);
  return safeJson({ events });
});
