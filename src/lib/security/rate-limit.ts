import "server-only";
import { prisma } from "@/lib/prisma";
import { fingerprint } from "./crypto";
import { log } from "./logger";

/**
 * Server-side rate limiting (§22).
 *
 * Backed by the database, not process memory, because this runs on serverless
 * functions: an in-process counter is reset by every cold start and is not
 * shared between concurrent instances, so it limits almost nothing.
 *
 * Keys combine the endpoint with the most specific actor we can identify.
 * IP alone is not enough — offices, universities, carrier NAT and VPNs put
 * thousands of unrelated people behind one address — so authenticated
 * requests are limited per user, and unauthenticated ones per IP, with the
 * endpoint always part of the key.
 *
 * Responses are a bare 429 with a Retry-After. They never say which limit was
 * hit or how much budget remains, which would help an attacker tune their
 * rate (§22 "return 429 without leaking security information").
 */

export interface RateLimitRule {
  /** Window length in seconds. */
  windowSeconds: number;
  /** Requests permitted per window. */
  max: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets. Only meaningful when ok is false. */
  retryAfter: number;
}

/**
 * Named budgets. Two dimensions where it matters: a short burst window that
 * stops hammering, and a longer sustained window that stops slow grinding.
 */
export const RATE_LIMITS = {
  // --- Expensive third-party work ---
  ai: { windowSeconds: 60, max: 10 },
  aiSustained: { windowSeconds: 3600, max: 60 },
  plaidLinkToken: { windowSeconds: 300, max: 10 },
  plaidExchange: { windowSeconds: 3600, max: 10 },
  plaidSync: { windowSeconds: 300, max: 6 },
  cancelHelper: { windowSeconds: 3600, max: 20 },

  // --- Expensive local work ---
  report: { windowSeconds: 60, max: 20 },
  recurring: { windowSeconds: 60, max: 20 },
  export: { windowSeconds: 3600, max: 3 },

  // --- Ordinary authenticated reads/writes ---
  read: { windowSeconds: 60, max: 240 },
  write: { windowSeconds: 60, max: 90 },

  // --- Unauthenticated surface ---
  webhook: { windowSeconds: 60, max: 600 },
  anonymous: { windowSeconds: 60, max: 30 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/**
 * Best-effort client IP. Only trusted headers set by the platform edge are
 * consulted; a client-supplied X-Forwarded-For further down the chain is not
 * authoritative, which is why IP is never the sole limiter for authenticated
 * routes.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // Vercel appends the real client IP as the left-most entry.
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() ?? "unknown";
}

/**
 * Consume one unit of budget.
 *
 * The counter is incremented with an atomic upsert so that concurrent
 * requests on different instances cannot both read "0" and both proceed.
 */
export async function consumeRateLimit(
  name: RateLimitName,
  actor: string,
  ruleOverride?: RateLimitRule,
): Promise<RateLimitResult> {
  const rule = ruleOverride ?? RATE_LIMITS[name];
  const now = new Date();
  // Fixed windows, aligned to the clock, so the key itself encodes the window
  // and an expired window is simply a different key.
  const windowIndex = Math.floor(now.getTime() / (rule.windowSeconds * 1000));
  const key = fingerprint(name, actor, String(windowIndex));
  const resetAt = new Date((windowIndex + 1) * rule.windowSeconds * 1000);

  try {
    const counter = await prisma.rateLimitCounter.upsert({
      where: { key },
      create: { key, count: 1, resetAt },
      update: { count: { increment: 1 } },
    });

    if (counter.count > rule.max) {
      return {
        ok: false,
        retryAfter: Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)),
      };
    }
    return { ok: true, retryAfter: 0 };
  } catch (error) {
    // A limiter that is itself broken must not lock every user out of the
    // product. We fail open here and make the failure loudly visible, because
    // the alternative — a database blip taking the whole app offline — is a
    // worse outcome than a brief unlimited window. Auth endpoints do not rely
    // on this path: Better Auth runs its own limiter in front of them.
    log.error("Rate limiter unavailable; failing open", { limit: name, error });
    return { ok: true, retryAfter: 0 };
  }
}

/**
 * Multi-dimensional limiting: every rule must pass. Used to apply a burst and
 * a sustained budget together, or to limit by user AND by IP so that one
 * abusive network cannot be laundered through many fresh accounts.
 */
export async function consumeAll(
  checks: Array<{ name: RateLimitName; actor: string }>,
): Promise<RateLimitResult> {
  for (const check of checks) {
    const result = await consumeRateLimit(check.name, check.actor);
    if (!result.ok) return result;
  }
  return { ok: true, retryAfter: 0 };
}

/** Housekeeping: drop windows that have already elapsed. */
export async function pruneRateLimitCounters(): Promise<number> {
  const { count } = await prisma.rateLimitCounter.deleteMany({
    where: { resetAt: { lt: new Date() } },
  });
  return count;
}
