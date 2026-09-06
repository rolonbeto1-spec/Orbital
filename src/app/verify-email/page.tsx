"use client";

import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { AuthForm, Field } from "@/components/auth/AuthForm";

/**
 * Resend a verification email.
 *
 * The link in the email is handled by Better Auth's own endpoint under
 * /api/auth; this page exists only for "I never got it".
 */
export default function VerifyEmailPage() {
  return (
    <AuthForm
      title="Confirm your email"
      description="We need to confirm your email address before you can connect a bank."
      submitLabel="Resend confirmation"
      onSubmit={async (data) => {
        await authClient.sendVerificationEmail({
          email: String(data.get("email") ?? ""),
          callbackURL: "/app",
        });
        // Neutral response, same as the reset flow (§24).
        return {
          message: "If that address needs confirming, a new link is on its way.",
        };
      }}
      footer={
        <Link href="/login" className="underline">
          Back to sign in
        </Link>
      }
    >
      <Field label="Email" name="email" type="email" autoComplete="email" />
    </AuthForm>
  );
}
