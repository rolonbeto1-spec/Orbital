"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { Plus, Loader2 } from "lucide-react";
import { apiPost } from "@/lib/client";

// Launches Plaid Link to connect a bank. On success, exchanges the token and
// triggers a refresh. Shows a helpful message if Plaid keys aren't set up yet.
export function ConnectBank({
  configured,
  onConnected,
  variant = "primary",
}: {
  configured: boolean;
  onConnected?: () => void;
  variant?: "primary" | "ghost";
}) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLinkToken = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await apiPost<{ link_token: string }>("/api/plaid/create-link-token");
      setLinkToken(res.link_token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start bank connect");
    } finally {
      setBusy(false);
    }
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (public_token) => {
      setBusy(true);
      try {
        await apiPost("/api/plaid/exchange-public-token", { public_token });
        onConnected?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to link account");
      } finally {
        setBusy(false);
        setLinkToken(null);
      }
    },
    onExit: () => setLinkToken(null),
  });

  // Auto-open once we have a token and Link is ready.
  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  if (!configured) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface-2 px-4 py-3 text-sm text-text-muted">
        <p className="font-medium text-text">Demo mode</p>
        <p className="mt-0.5">
          To unlock bank connections, add your Plaid keys — on Vercel under
          Settings → Environment Variables, or in{" "}
          <code className="rounded bg-bg px-1">.env</code> when running locally —
          then redeploy. See the README.
        </p>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={fetchLinkToken}
        disabled={busy}
        className={`btn ${variant === "primary" ? "btn-primary" : "btn-ghost"} w-full px-4 py-3 text-sm`}
      >
        {busy ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
        Connect a bank
      </button>
      {error && <p className="mt-2 text-xs text-negative">{error}</p>}
    </div>
  );
}
