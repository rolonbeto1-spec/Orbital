"use client";

import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { AuthForm, Field } from "@/components/auth/AuthForm";

export default function SignupPage() {
  return (
    <AuthForm
      title="Create your Metta account"
      description="Metta connects to your bank read-only. It can see balances and transactions, and it can never move money."
      submitLabel="Create account"
      onSubmit={async (data) => {
        const email = String(data.get("email") ?? "");
        const { error } = await authClient.signUp.email({
          email,
          password: String(data.get("password") ?? ""),
          name: String(data.get("name") ?? "").trim() || email.split("@")[0],
        });

        if (error) {
          // Registration may be closed, or the password may be too short.
          // The server never reveals whether the address already exists (§24).
          return {
            error:
              error.message ??
              "We could not create that account. Please check your details and try again.",
          };
        }

        // Deliberately the same message whatever happened, including when the
        // address was already registered — the server sends a notice to the
        // real account holder instead of telling the visitor (§24).
        return {
          message:
            "Check your email. If we could create the account, a confirmation link is on its way.",
        };
      }}
      footer={
        <div className="space-y-2">
          <p>
            Already have an account?{" "}
            <Link href="/login" className="underline">
              Sign in
            </Link>
          </p>
          <p className="text-xs">
            By creating an account you agree to the{" "}
            <Link href="/legal/terms" className="underline">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/legal/privacy" className="underline">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      }
    >
      <Field label="Name" name="name" autoComplete="name" required={false} />
      <Field label="Email" name="email" type="email" autoComplete="email" />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={12}
        placeholder="At least 12 characters"
      />
    </AuthForm>
  );
}
