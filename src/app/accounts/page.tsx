"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronLeft, Building2, Trash2, Briefcase } from "lucide-react";
import { AccountRow } from "@/components/AccountRow";
import { ConnectBank } from "@/components/ConnectBank";
import { useApi, apiDelete, apiPatch } from "@/lib/client";
import { formatCurrency } from "@/lib/format";
import type { Account, NetWorth } from "@/lib/types";

interface ItemWithAccounts {
  id: string;
  institutionName: string;
  accounts: Account[];
}

interface AccountsData extends NetWorth {
  items: ItemWithAccounts[];
  accounts: Account[];
  plaidConfigured: boolean;
}

export default function AccountsPage() {
  const { data, loading, refetch } = useApi<AccountsData>("/api/accounts");
  const [removing, setRemoving] = useState<string | null>(null);

  async function disconnect(id: string) {
    setRemoving(id);
    try {
      await apiDelete(`/api/items/${id}`);
      await refetch();
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div>
      <header className="flex items-center gap-2 px-4 pb-2 pt-6">
        <Link href="/" className="rounded-full p-2 active:bg-surface-2">
          <ChevronLeft size={22} />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Accounts</h1>
      </header>

      {data && (
        <div className="mx-5 mb-2 card p-4">
          <p className="text-sm text-text-muted">Total net worth</p>
          <p className="text-3xl font-bold tabular-nums">
            {formatCurrency(data.netWorth)}
          </p>
          <div className="mt-2 flex gap-4 text-xs text-text-muted">
            <span>{formatCurrency(data.assets)} assets</span>
            <span>{formatCurrency(data.liabilities)} debt</span>
          </div>
        </div>
      )}

      {loading && !data ? (
        <div className="mx-5 mt-4 h-40 animate-pulse rounded-2xl bg-surface-2" />
      ) : (
        <div className="mt-4 flex flex-col gap-5">
          {data?.items.map((item) => (
            <div key={item.id}>
              <div className="mb-1 flex items-center justify-between px-5">
                <div className="flex items-center gap-2">
                  <Building2 size={16} className="text-text-muted" />
                  <h2 className="text-sm font-semibold">{item.institutionName}</h2>
                </div>
                <button
                  onClick={() => disconnect(item.id)}
                  disabled={removing === item.id}
                  className="flex items-center gap-1 text-xs font-medium text-text-faint active:text-negative"
                >
                  <Trash2 size={13} />
                  {removing === item.id ? "Removing…" : "Disconnect"}
                </button>
              </div>
              <div className="card mx-5 overflow-hidden">
                {item.accounts.map((a, i) => (
                  <div key={a.id}>
                    {i > 0 && <div className="mx-5 border-t border-border" />}
                    <AccountRow account={a} />
                    <BusinessToggle account={a} onChanged={refetch} />
                  </div>
                ))}
              </div>
            </div>
          ))}

          {data && data.items.length === 0 && (
            <p className="px-5 text-center text-sm text-text-faint">
              No banks connected yet.
            </p>
          )}

          <div className="mx-5">
            <ConnectBank
              configured={data?.plaidConfigured ?? false}
              onConnected={refetch}
            />
          </div>

          <SignOut />
        </div>
      )}
    </div>
  );
}

// Shown only when the login gate is on (deployed with APP_PASSWORD).
function SignOut() {
  const { data } = useApi<{ enabled: boolean }>("/api/auth");
  if (!data?.enabled) return null;
  return (
    <button
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/login";
      }}
      className="mx-auto mb-2 text-xs font-semibold text-text-faint underline"
    >
      Sign out on this device
    </button>
  );
}

// Flip an account into (or out of) business mode: it gets its own breakdown
// screen and stays out of personal budgets and the hive's spending math.
function BusinessToggle({
  account,
  onChanged,
}: {
  account: Account & { isBusiness?: boolean };
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const on = !!account.isBusiness;

  async function toggle() {
    setBusy(true);
    try {
      await apiPatch(`/api/accounts/${account.id}`, { isBusiness: !on });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className="flex w-full items-center gap-2 px-5 pb-3 text-left"
    >
      <Briefcase size={13} className={on ? "text-primary" : "text-text-faint"} />
      <span className="flex-1 text-xs font-medium text-text-muted">
        Business account
        {on && (
          <Link
            href="/business"
            onClick={(e) => e.stopPropagation()}
            className="ml-2 font-semibold text-primary underline"
          >
            open breakdown →
          </Link>
        )}
      </span>
      <span
        className="relative h-5 w-9 shrink-0 rounded-full transition-colors"
        style={{ background: on ? "var(--primary)" : "var(--border)" }}
      >
        <span
          className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all"
          style={{ left: on ? 18 : 2 }}
        />
      </span>
    </button>
  );
}
