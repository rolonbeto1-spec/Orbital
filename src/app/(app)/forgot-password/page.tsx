"use client";

import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { AuthForm, Field } from "@/components/auth/AuthForm";

export default function ForgotPasswordPage() {
  return (
    <AuthForm
      title="Reset your password"
      description="We'll email you a link to set a new password."
      submitLabel="Send reset link"
      onSubmit={async (data) => {
        await authClient.requestPasswordReset({
          email: String(data.get("email") ?? ""),
          redirectTo: "/reset-password",
        });

        // The SAME neutral response whether or not the address exists, and
        // whether or not the request succeeded. Anything else would turn this
        // form into an account-enumeration oracle (§24).
        return {
          message:
            "If an account exists for that email, instructions have been sent.",
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
