"use client";

import { useState } from "react";
import { HandCoins, ChevronRight, X, Check } from "lucide-react";
import { useApi, apiPost } from "@/lib/client";
import { formatCurrency, formatDateShort } from "@/lib/format";

interface OwedItem {
  id: string;
  name: string;
  date: string;
  amount: number;
  reimbursed: number;
  outstanding: number;
  category: { name: string } | null;
}
interface Repayment {
  id: string;
  name: string;
  date: string;
  amount: number;
}
interface Data {
  totalOwed: number;
  outstanding: OwedItem[];
  possibleRepayments: Repayment[];
}

// Shows "you're owed $X" when there are outstanding reimbursements, and a sheet
// to mark them paid back.
export function ReimbursementsBanner({ onChange }: { onChange?: () => void }) {
  const { data, refetch } = useApi<Data>("/api/reimbursements");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (!data || data.totalOwed <= 0) return null;

  async function markPaid(id: string) {
    setBusy(id);
    try {
      await apiPost("/api/reimbursements", { id, full: true });
      await refetch();
      onChange?.();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mx-5 mt-1 flex w-[calc(100%-2.5rem)] items-center gap-3 rounded-xl border border-primary/30 bg-primary-soft px-4 py-3 text-left"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-white">
          <HandCoins size={18} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-primary">
            You&apos;re owed {formatCurrency(data.totalOwed)} back
          </p>
          <p className="text-xs text-text-muted">
            {data.outstanding.length} purchase{data.outstanding.length > 1 ? "s" : ""} · nets out of
            spending as it&apos;s paid back
          </p>
        </div>
        <ChevronRight size={18} className="text-primary" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative z-10 max-h-[82%] w-full max-w-[480px] overflow-y-auto rounded-t-3xl bg-surface p-5 pb-8 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-lg font-bold">Owed back to you</p>
                <p className="text-sm text-text-muted">
                  {formatCurrency(data.totalOwed)} outstanding
                </p>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-full bg-surface-2 p-2">
                <X size={18} />
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {data.outstanding.map((it) => (
                <div
                  key={it.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{it.name}</p>
                    <p className="text-xs text-text-muted">
                      {it.category?.name ?? "Uncategorized"} · {formatDateShort(it.date)}
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums">
                    {formatCurrency(it.outstanding)}
                  </span>
                  <button
                    onClick={() => markPaid(it.id)}
                    disabled={busy === it.id}
                    className="btn btn-primary flex items-center gap-1 px-3 py-2 text-xs"
                  >
                    <Check size={14} />
                    {busy === it.id ? "…" : "Paid"}
                  </button>
                </div>
              ))}
            </div>

            {data.possibleRepayments.length > 0 && (
              <div className="mt-5">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Money in that might be a repayment
                </p>
                <div className="flex flex-col gap-1.5">
                  {data.possibleRepayments.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm"
                    >
                      <span className="text-text-muted">
                        {r.name} · {formatDateShort(r.date)}
                      </span>
                      <span className="font-semibold tabular-nums text-positive">
                        +{formatCurrency(r.amount)}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-text-faint">
                  Tap a purchase above and &ldquo;Paid&rdquo; once one of these covers it.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
