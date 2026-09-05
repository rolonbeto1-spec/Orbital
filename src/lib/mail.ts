import "server-only";
import { env, isProduction } from "@/lib/env";
import { log } from "@/lib/security/logger";

/**
 * Transactional email (§58, §71).
 *
 * Deliberately implemented against Resend's REST API with plain fetch rather
 * than pulling in another dependency — one fewer package with install scripts
 * and transitive dependencies in the supply chain (§43).
 *
 * Safety properties:
 *  - recipients are validated and single-valued, so a caller cannot smuggle a
 *    second recipient or a header through the address (§58 header injection);
 *  - newlines are stripped from the subject for the same reason;
 *  - message bodies never contain financial data — Metta emails say "your
 *    password changed", never "your balance is X" (§71);
 *  - failures are logged and surfaced to the caller, never swallowed silently
 *    for security-critical mail.
 */

export interface SendMailInput {
  to: string;
  subject: string;
  /** Plain text only. We do not send HTML, so there is no HTML injection surface. */
  text: string;
}

/** RFC-5322-ish sanity check. Not a validator — a gate against header injection. */
const SAFE_EMAIL = /^[^\s<>",;:\\]+@[^\s<>",;:\\@]+\.[A-Za-z]{2,}$/;

export class MailError extends Error {}

function assertSafeRecipient(to: string): void {
  if (to.length > 254 || !SAFE_EMAIL.test(to)) {
    throw new MailError("Invalid recipient address.");
  }
  // Belt and braces: CR/LF in an address or subject is the classic header
  // injection vector.
  if (/[\r\n]/.test(to)) throw new MailError("Invalid recipient address.");
}

function sanitizeSubject(subject: string): string {
  return subject.replace(/[\r\n]+/g, " ").slice(0, 200);
}

export async function sendMail({ to, subject, text }: SendMailInput): Promise<void> {
  assertSafeRecipient(to);
  const safeSubject = sanitizeSubject(subject);

  if (env.EMAIL_PROVIDER === "console") {
    if (isProduction) {
      // assertProductionSecrets() should have caught this at startup; if we
      // somehow got here, fail loudly rather than pretend mail was sent.
      throw new MailError("Email provider is not configured.");
    }
    // Development only, and guarded by the isProduction check above. The body
    // contains a verification or reset link, which is a credential — that is
    // exactly why this cannot use the redacting logger (it would scrub the
    // link a developer needs) and exactly why it never runs in production.
    // eslint-disable-next-line no-console -- dev-only, unreachable in production
    console.log(`\n--- dev email ---\nto: ${to}\nsubject: ${safeSubject}\n\n${text}\n---\n`);
    return;
  }

  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new MailError("Email provider is not configured.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [to],
      subject: safeSubject,
      text,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    // Log the status, never the body — provider error bodies echo the request.
    log.error("Transactional email failed", { status: response.status });
    throw new MailError("Could not send email.");
  }
}

/**
 * Security notifications (§71). Sent on their own, never bundled with
 * financial content, and always phrased so that reading the email discloses
 * nothing about the account's money.
 */
export async function sendSecurityNotice(
  to: string,
  event: "password-changed" | "password-reset" | "email-changed" | "bank-connected" | "bank-disconnected",
): Promise<void> {
  const messages: Record<typeof event, { subject: string; text: string }> = {
    "password-changed": {
      subject: "Your Metta password was changed",
      text:
        "The password on your Metta account was just changed.\n\n" +
        "If that was you, there is nothing to do.\n\n" +
        "If it was not you, reset your password immediately and sign out all " +
        "devices from Settings → Security.",
    },
    "password-reset": {
      subject: "Your Metta password was reset",
      text:
        "Your Metta password was reset using a password-reset link.\n\n" +
        "If that was you, there is nothing to do.\n\n" +
        "If it was not you, reset your password again immediately and sign out " +
        "all devices from Settings → Security.",
    },
    "email-changed": {
      subject: "Your Metta email address was changed",
      text:
        "The email address on your Metta account was changed.\n\n" +
        "If this was not you, contact support immediately.",
    },
    "bank-connected": {
      subject: "A bank was connected to your Metta account",
      text:
        "A new bank connection was added to your Metta account.\n\n" +
        "Metta's access is read-only: it can see balances and transactions and " +
        "can never move money.\n\n" +
        "If this was not you, remove the connection in Settings → Connections " +
        "and change your password.",
    },
    "bank-disconnected": {
      subject: "A bank was disconnected from your Metta account",
      text:
        "A bank connection was removed from your Metta account.\n\n" +
        "If this was not you, change your password and review your connections " +
        "in Settings → Connections.",
    },
  };

  const { subject, text } = messages[event];
  // A failed notification must not break the action that triggered it — the
  // password change already happened. Log and continue.
  try {
    await sendMail({ to, subject, text });
  } catch {
    log.warn("Security notification could not be delivered", { event });
  }
}
