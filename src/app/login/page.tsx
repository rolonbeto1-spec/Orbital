"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";

// The front door when the app is deployed. Plain password sign-in; the
// session lasts 30 days per device.

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Something went wrong — try again.");
        return;
      }
      router.replace(params.get("from") || "/");
      router.refresh();
    } catch {
      setError("Couldn't reach the app — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-8">
      <div
        className="flex h-16 w-16 items-center justify-center text-white"
        style={{ clipPath: "var(--hex)", background: "var(--primary)" }}
      >
        <Lock size={26} />
      </div>
      <h1 className="mt-5 text-2xl font-bold tracking-tight">Metta</h1>
      <p className="mt-1 text-sm text-text-muted">Enter your password to open the app.</p>

      <form onSubmit={submit} className="mt-8 w-full max-w-xs">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          autoComplete="current-password"
          className="w-full rounded-xl border border-border bg-surface px-4 py-3.5 text-center text-lg outline-none focus:border-primary"
        />
        {error && (
          <p className="mt-3 text-center text-sm font-medium text-negative">{error}</p>
        )}
        <button
          type="submit"
          disabled={busy || !password}
          className="btn btn-primary mt-4 w-full py-3.5 text-[15px]"
        >
          {busy ? "Checking…" : "Sign in"}
        </button>
      </form>

      <p className="mt-10 max-w-xs text-center text-[11px] leading-relaxed text-text-faint">
        Sessions last 30 days on this device. Your data never leaves your own app.
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
