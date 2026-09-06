import { route, safeJson } from "@/lib/security/api";
import { prisma } from "@/lib/prisma";
import { consentUpdate } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Record that the user accepted the Terms, the Privacy Policy, or the
 * read-only bank-connection disclosure (§38, §69).
 *
 * Timestamps only — the consent record says when, and the versioned documents
 * in /legal say what was agreed to.
 */
export const POST = route(
  { auth: "unverified", limits: ["write"], body: consentUpdate, audit: "account.consent" },
  async (ctx) => {
    const now = new Date();
    await prisma.user.update({
      where: { id: ctx.user.id },
      data: {
        ...(ctx.body.acceptTerms ? { termsAcceptedAt: now } : {}),
        ...(ctx.body.acceptPrivacy ? { privacyAcceptedAt: now } : {}),
        ...(ctx.body.acceptBankConsent ? { bankConsentAt: now } : {}),
      },
    });
    return safeJson({ ok: true });
  },
);
