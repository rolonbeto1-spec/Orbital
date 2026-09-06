import { route, safeJson } from "@/lib/security/api";
import { prisma } from "@/lib/prisma";
import { profileUpdate } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The user's own profile (§70).
 *
 * Returns identity and consent state — never a password hash, a session
 * token, or anything about another account.
 */
export const GET = route({ auth: "unverified", limits: ["read"] }, async (ctx) => {
  const [itemCount, aiUsed] = await Promise.all([
    prisma.item.count({ where: { userId: ctx.user.id } }),
    prisma.setting.count({ where: { userId: ctx.user.id } }),
  ]);

  return safeJson({
    name: ctx.user.name,
    email: ctx.user.email,
    emailVerified: ctx.user.emailVerified,
    timezone: ctx.user.timezone,
    role: ctx.user.role,
    onboardedAt: ctx.user.onboardedAt,
    termsAcceptedAt: ctx.user.termsAcceptedAt,
    bankConsentAt: ctx.user.bankConsentAt,
    connectedBanks: itemCount,
    hasSettings: aiUsed > 0,
  });
});

export const PATCH = route(
  { auth: "user", limits: ["write"], body: profileUpdate, audit: "account.profile_updated" },
  async (ctx) => {
    // Only these two fields. Role, email and plaidUserRef are deliberately
    // not updatable here: changing an email is an identity change that goes
    // through Better Auth's verification flow, and role is never
    // self-service (§35).
    await prisma.user.update({
      where: { id: ctx.user.id },
      data: {
        ...(ctx.body.name !== undefined ? { name: ctx.body.name } : {}),
        ...(ctx.body.timezone !== undefined ? { timezone: ctx.body.timezone } : {}),
      },
    });
    return safeJson({ ok: true });
  },
);
