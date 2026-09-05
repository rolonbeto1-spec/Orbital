import "server-only";
import { headers } from "next/headers";
import { cache } from "react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * The single source of truth for "who is making this request" (§13).
 *
 * Everything else in the app derives the tenant from here. No route reads a
 * user id from a query string, a JSON body, a header or a cookie of its own
 * (§3) — the id comes from a server-verified session and nowhere else.
 *
 * Default is DENY: if the session is missing, expired, revoked, or belongs to
 * a deleted account, these helpers throw and the request is refused.
 */

export interface AuthedUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  role: "USER" | "ADMIN";
  timezone: string;
  plaidUserRef: string;
  onboardedAt: Date | null;
  termsAcceptedAt: Date | null;
  bankConsentAt: Date | null;
  aiDailyLimit: number | null;
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Not allowed") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Resolve the current user, or null.
 *
 * Wrapped in React's `cache` so that a single server render or request
 * resolves the session once rather than per component. The cache is per
 * request by construction — it is NOT a shared cross-user cache, which is the
 * distinction that matters for §53.
 */
export const getCurrentUser = cache(async (): Promise<AuthedUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) return null;

  // Re-read from our own table rather than trusting the session payload for
  // authorization-relevant fields. The session may predate a role change, an
  // email change, or a deletion.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      emailVerified: true,
      name: true,
      role: true,
      timezone: true,
      plaidUserRef: true,
      onboardedAt: true,
      termsAcceptedAt: true,
      bankConsentAt: true,
      aiDailyLimit: true,
      deletedAt: true,
    },
  });

  if (!user || user.deletedAt) return null;

  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    name: user.name,
    role: user.role === "ADMIN" ? "ADMIN" : "USER",
    timezone: user.timezone,
    plaidUserRef: user.plaidUserRef,
    onboardedAt: user.onboardedAt,
    termsAcceptedAt: user.termsAcceptedAt,
    bankConsentAt: user.bankConsentAt,
    aiDailyLimit: user.aiDailyLimit,
  };
});

/**
 * Require an authenticated, verified user. Throws otherwise.
 *
 * Email verification is part of the gate rather than a soft nudge: an
 * unverified address means we have not established that the person signing up
 * controls the mailbox that can reset the password.
 */
export async function requireUser(): Promise<AuthedUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError();
  if (!user.emailVerified) {
    throw new ForbiddenError("Email address is not verified");
  }
  return user;
}

/**
 * Require an authenticated user who may not yet have verified their email.
 * Only for the handful of endpoints that exist to *complete* verification.
 */
export async function requireUserAllowingUnverified(): Promise<AuthedUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError();
  return user;
}

/**
 * Require an administrator (§34, §35).
 *
 * The role is read from the database on every call, never from a cookie, a
 * header, a JWT claim or anything else the client can influence. There are
 * exactly two roles; we do not invent a permission system we have no use for.
 */
export async function requireAdmin(): Promise<AuthedUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    throw new ForbiddenError("Administrator access required");
  }
  return user;
}
