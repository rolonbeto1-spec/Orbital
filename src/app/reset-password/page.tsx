"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { authClient } from "@/lib/auth-client";
import { AuthForm, Field } from "@/components/auth/AuthForm";

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";

  return (
    <AuthForm
      title="Choose a new password"
      description="Setting a new password signs you out everywhere else."
      submitLabel="Set new password"
      onSubmit={async (data) => {
        const password = String(data.get("password") ?? "");
        const confirm = String(data.get("confirm") ?? "");
        if (password !== confirm) return { error: "Those passwords do not match." };
        if (!token) return { error: "This reset link is missing its token." };

        const { error } = await authClient.resetPassword({ newPassword: password, token });
        if (error) {
          return {
            error:
              "That reset link is invalid or has expired. Request a new one and try again.",
          };
        }
        router.push("/login");
        return { message: "Password updated. You can sign in now." };
      }}
      footer={
        <Link href="/forgot-password" className="underline">
          Request a new link
        </Link>
      }
    >
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={12}
      />
      <Field
        label="Confirm new password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        minLength={12}
      />
    </AuthForm>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetForm />
    </Suspense>
  );
}
