"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { TransactionRow } from "@/components/TransactionRow";
import { TransactionEditor } from "@/components/TransactionEditor";
import { ReimbursementsBanner } from "@/components/ReimbursementsBanner";
import { Card } from "@/components/Section";
import { ALL_ACCOUNTS, scopeParams, type AccountScope } from "@/components/AccountFilter";
import { useApi } from "@/lib/client";
import { formatCurrency } from "@/lib/format";
import type { BankWithAccounts, Category, Transaction } from "@/lib/types";

interface TxnResponse {
  transactions: Transaction[];
  total: number;
  limit: number;
  offset: number;
}

export default function TransactionsPage() {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [scope, setScope] = useState<AccountScope>(ALL_ACCOUNTS);
  const [limit, setLimit] = useState(50);
  const [editing, setEditing] = useState<Transaction | null>(null);

  const { data: catData } = useApi<{ categories: Category[] }>("/api/categories");
  const { data: acctData } = useApi<{ items: BankWithAccounts[] }>("/api/accounts");
  const { data: recurringData } = useApi<{ recurring: { merchant: string }[] }>("/api/recurring");
  const recurringNames = useMemo(
    () => new Set((recurringData?.recurring ?? []).map((r) => r.merchant.toLowerCase())),
    [recurringData],
  );

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const url = useMemo(() => {
    const p = new URLSearchParams();
    if (debounced) p.set("search", debounced);
    if (categoryId) p.set("category", categoryId);
    scopeParams(scope, p);
    p.set("limit", String(limit));
    return `/api/transactions?${p.toString()}`;
  }, [debounced, categoryId, scope, limit]);

  const { data, loading, setData, refetch } = useApi<TxnResponse>(url);

  const txns = data?.transactions ?? [];

  // Group transactions by day for a cleaner list.
  const groups = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const t of txns) {
      const key = new Date(t.date).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [txns]);

  function onSaved(updated: Transaction) {
    if (!data) return;
    setData({
      ...data,
      transactions: data.transactions.map((t) => (t.id === updated.id ? updated : t)),
    });
  }

  return (
    <div>
      <PageHeader
        title="Activity"
        subtitle={data ? `${data.total} transactions` : undefined}
      />

      <ReimbursementsBanner onChange={refetch} />

      {/* Search */}
      <div className="px-5">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5">
          <Search size={18} className="text-text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search merchants…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-text-faint"
          />
        </div>
      </div>

      {/* Filters: two dropdowns — banks & cards, categories. No chip clutter. */}
      <div className="mt-3 flex gap-2 px-5">
        <select
          value={scope.account ? `acct:${scope.account}` : scope.bank ? `bank:${scope.bank}` : ""}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) setScope(ALL_ACCOUNTS);
            else if (v.startsWith("bank:")) setScope({ bank: v.slice(5), account: null });
            else setScope({ bank: null, account: v.slice(5) });
          }}
          className="min-w-0 flex-1 appearance-none rounded-full border border-border bg-surface px-3.5 py-2 text-xs font-semibold text-text outline-none"
        >
          <option value="">All banks &amp; cards</option>
          {acctData?.items.map((b) => (
            <optgroup key={b.id} label={b.institutionName.replace(/\s*\(sample( data)?\)/i, "")}>
              {b.accounts.length > 1 && (
                <option value={`bank:${b.id}`}>
                  Everything at {b.institutionName.replace(/\s*\(sample( data)?\)/i, "")}
                </option>
              )}
              {b.accounts.map((a) => (
                <option key={a.id} value={`acct:${a.id}`}>
                  {a.name}
                  {a.mask ? ` ··${a.mask}` : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <select
          value={categoryId ?? ""}
          onChange={(e) => setCategoryId(e.target.value || null)}
          className="min-w-0 flex-1 appearance-none rounded-full border border-border bg-surface px-3.5 py-2 text-xs font-semibold text-text outline-none"
        >
          <option value="">All categories</option>
          {catData?.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* List */}
      <div className="mt-4">
        {loading && !data ? (
          <div className="px-5">
            <div className="h-64 animate-pulse rounded-2xl bg-surface-2" />
          </div>
        ) : txns.length === 0 ? (
          <p className="mt-10 px-5 text-center text-sm text-text-faint">
            No transactions found.
          </p>
        ) : (
          groups.map(([day, items]) => {
            const dayTotal = items.reduce((s, t) => s + (t.amount > 0 ? t.amount : 0), 0);
            return (
              <div key={day} className="mb-4">
                <div className="flex items-center justify-between px-5 pb-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                    {day}
                  </span>
                  <span className="text-xs text-text-faint tabular-nums">
                    {formatCurrency(dayTotal)} spent
                  </span>
                </div>
                <Card>
                  {items.map((t, i) => (
                    <div key={t.id}>
                      {i > 0 && <div className="mx-5 border-t border-border" />}
                      <TransactionRow
                        txn={t}
                        recurring={recurringNames.has((t.merchantName || t.name).trim().toLowerCase())}
                        onClick={() => setEditing(t)}
                      />
                    </div>
                  ))}
                </Card>
              </div>
            );
          })
        )}

        {data && data.total > txns.length && (
          <div className="px-5 pb-4">
            <button
              onClick={() => setLimit((l) => l + 50)}
              className="btn btn-ghost w-full py-3 text-sm"
            >
              Load more
            </button>
          </div>
        )}
      </div>

      {editing && (
        <TransactionEditor
          txn={editing}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

function Chip({
  children,
  active,
  onClick,
  color,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors"
      style={{
        borderColor: active ? "transparent" : "var(--border)",
        background: active ? color || "var(--primary)" : "var(--surface)",
        color: active ? "#fff" : "var(--text-muted)",
      }}
    >
      {children}
    </button>
  );
}
