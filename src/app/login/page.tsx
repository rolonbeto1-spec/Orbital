"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { authClient } from "@/lib/auth-client";
import { AuthForm, Field } from "@/components/auth/AuthForm";
import { safeRedirectTarget } from "@/lib/safe-redirect";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  // Validated client-side for UX and re-validated server-side by the proxy;
  // an attacker-supplied ?from= can only ever be an internal path (§19).
  const from = safeRedirectTarget(params.get("from"));

  return (
    <AuthForm
      title="Sign in to Metta"
      submitLabel="Sign in"
      onSubmit={async (data) => {
        const { error } = await authClient.signIn.email({
          email: String(data.get("email") ?? ""),
          password: String(data.get("password") ?? ""),
        });
        if (error) {
          // One message for every failure mode. Distinguishing "no such
          // account" from "wrong password" would confirm which addresses are
          // registered (§24).
          return { error: "That email and password combination did not work." };
        }
        router.push(from);
        router.refresh();
        return {};
      }}
      footer={
        <div className="space-y-2">
          <p>
            <Link href="/forgot-password" className="underline">
              Forgot your password?
            </Link>
          </p>
          <p>
            No account?{" "}
            <Link href="/signup" className="underline">
              Create one
            </Link>
          </p>
        </div>
      }
    >
      <Field label="Email" name="email" type="email" autoComplete="email" />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
      />
    </AuthForm>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
