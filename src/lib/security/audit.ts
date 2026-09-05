import "server-only";
import { prisma } from "@/lib/prisma";
import { redact } from "./redact";
import { log } from "./logger";

/**
 * Security and account audit trail (§41).
 *
 * What belongs here: who did what, when, from roughly where — logins, resets,
 * email changes, bank connections, exports, deletions, denied access.
 *
 * What does NOT belong here: money. No amounts, balances, merchant names,
 * transaction descriptions or notes. The audit table must not become a second
 * copy of the financial database sitting behind weaker access controls.
 *
 * Tamper resistance: the table is append-only from the application's point of
 * view — no route updates or deletes an AuditEvent, and no route exposes
 * another user's events. A user cannot reach their own rows except through
 * the read-only listing in Settings.
 */

export type AuditOutcome = "success" | "failure" | "denied";

export interface AuditInput {
  /** Null when the actor is unknown or the user row is being deleted. */
  userId?: string | null;
  /** Stable dotted event name, e.g. "plaid.item.removed". */
  type: string;
  outcome?: AuditOutcome;
  ip?: string;
  userAgent?: string;
  /** Small, non-financial context. Redacted before it is written. */
  meta?: Record<string, unknown>;
}

/** Coarsen an IP so the trail is useful for incident response without being a tracking log. */
function coarsenIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  // IPv4: drop the last octet. IPv6: keep the /48 prefix.
  if (ip.includes(":")) return `${ip.split(":").slice(0, 3).join(":")}::/48`;
  const parts = ip.split(".");
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0/24` : undefined;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    // A user id that no longer exists (deletion) must not break the write:
    // the FK is SetNull, but we would still fail on insert, so verify first.
    let userId = input.userId ?? null;
    if (userId) {
      const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!exists) userId = null;
    }

    await prisma.auditEvent.create({
      data: {
        userId,
        type: input.type.slice(0, 100),
        outcome: input.outcome ?? "success",
        ip: coarsenIp(input.ip),
        userAgent: input.userAgent?.slice(0, 200),
        meta: input.meta ? JSON.stringify(redact(input.meta)).slice(0, 2000) : null,
      },
    });
  } catch (error) {
    // An audit write must never take down the request it is describing, but
    // a failure to audit is itself worth knowing about.
    log.error("Audit write failed", { type: input.type, error });
  }
}

/** Read a user's own audit trail. Always scoped — there is no unscoped read. */
export async function listAuditEvents(userId: string, limit = 50) {
  return prisma.auditEvent.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
    select: { id: true, type: true, outcome: true, ip: true, createdAt: true },
  });
}
