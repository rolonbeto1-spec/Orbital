"use client";

import { useState, type FormEvent, type ReactNode } from "react";

/**
 * A plain, semantic form shell for the authentication screens.
 *
 * DESIGN HANDOFF NOTE (§78): this component is deliberately minimal and holds
 * no security or business logic — it renders fields, shows a message, and
 * calls the submit handler it is given. All authentication decisions happen on
 * the server. A designer can restyle or replace this entirely without touching
 * anything that matters for security.
 */
export function AuthForm({
  title,
  description,
  submitLabel,
  onSubmit,
  children,
  footer,
}: {
  title: string;
  description?: string;
  submitLabel: string;
  onSubmit: (formData: FormData) => Promise<{ error?: string; message?: string }>;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const result = await onSubmit(new FormData(event.currentTarget));
      if (result.error) setError(result.error);
      if (result.message) setMessage(result.message);
    } catch {
      // Never surface a raw exception to the user (§40).
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 p-6">
      <header className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold">{title}</h1>
        {description ? <p className="text-sm text-muted">{description}</p> : null}
      </header>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {children}

        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}
        {message ? (
          <p role="status" className="text-sm text-emerald-700">
            {message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-xl bg-primary px-4 py-3 font-medium text-white disabled:opacity-60"
        >
          {pending ? "Working…" : submitLabel}
        </button>
      </form>

      {footer ? <div className="text-sm text-muted">{footer}</div> : null}
    </main>
  );
}

/** A labelled input. No validation logic — the server is the authority (§14). */
export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  required = true,
  minLength,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        placeholder={placeholder}
        className="w-full rounded-xl border border-border bg-card px-3 py-2.5"
      />
    </label>
  );
}
