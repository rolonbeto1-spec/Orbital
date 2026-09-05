"use client";

import { useEffect, useState } from "react";
import { X, HandCoins, FolderPlus } from "lucide-react";
import { CategoryIcon } from "@/components/CategoryIcon";
import { formatCurrency, formatDate } from "@/lib/format";
import { apiPatch, useApi } from "@/lib/client";
import type { Category, Transaction } from "@/lib/types";

interface FolderRow {
  id: string;
  name: string;
  count: number;
  total: number;
}

// Bottom-sheet editor to recategorize a transaction and add a note.
export function TransactionEditor({
  txn,
  onClose,
  onSaved,
}: {
  txn: Transaction;
  onClose: () => void;
  onSaved: (t: Transaction) => void;
}) {
  const { data } = useApi<{ categories: Category[] }>("/api/categories");
  const { data: folderData } = useApi<{ folders: FolderRow[] }>("/api/folders");
  const [categoryId, setCategoryId] = useState(txn.categoryId);
  const [notes, setNotes] = useState(txn.notes ?? "");
  const [owedBack, setOwedBack] = useState(!!txn.owedBack);
  const [reimbursed, setReimbursed] = useState(txn.reimbursedAmount ?? 0);
  const [folderId, setFolderId] = useState<string | null>(txn.folderId ?? null);
  const [newFolder, setNewFolder] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  async function save() {
    setSaving(true);
    try {
      const updated = await apiPatch<Transaction>(`/api/transactions/${txn.id}`, {
        categoryId,
        notes,
        owedBack,
        reimbursedAmount: owedBack ? reimbursed : 0,
        ...(newFolder.trim() ? { folderName: newFolder.trim() } : { folderId }),
      });
      onSaved({ ...txn, ...updated });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const isIncome = txn.amount < 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-[480px] rounded-t-3xl bg-surface p-5 pb-8 shadow-lg animate-in">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <p className="text-lg font-bold">{txn.merchantName || txn.name}</p>
            <p className="text-sm text-text-muted">{formatDate(txn.date)}</p>
          </div>
          <button onClick={onClose} className="rounded-full bg-surface-2 p-2">
            <X size={18} />
          </button>
        </div>

        <p
          className="mb-5 text-3xl font-bold tabular-nums"
          style={{ color: isIncome ? "var(--positive)" : "var(--text)" }}
        >
          {isIncome ? "+" : "-"}
          {formatCurrency(Math.abs(txn.amount))}
        </p>

        <p className="mb-2 text-sm font-semibold text-text-muted">Category</p>
        <div className="mb-5 grid max-h-52 grid-cols-4 gap-2 overflow-y-auto">
          {data?.categories.map((c) => {
            const active = c.id === categoryId;
            return (
              <button
                key={c.id}
                onClick={() => setCategoryId(c.id)}
                className="flex flex-col items-center gap-1 rounded-xl p-2 transition-colors"
                style={{
                  background: active ? "var(--primary-soft)" : "transparent",
                  outline: active ? "2px solid var(--primary)" : "none",
                }}
              >
                <CategoryIcon icon={c.icon} color={c.color} size={34} />
                <span className="text-center text-[10px] leading-tight text-text-muted">
                  {c.name}
                </span>
              </button>
            );
          })}
        </div>

        <p className="mb-4 text-[11px] text-text-faint">
          Changing the category teaches the app — future purchases from this merchant will
          follow your choice.
        </p>

        <p className="mb-2 text-sm font-semibold text-text-muted">Note</p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Add a note…"
          rows={2}
          className="mb-5 w-full resize-none rounded-xl border border-border bg-surface-2 p-3 text-sm outline-none focus:border-primary"
        />

        {/* Bookkeeping: file this charge into a folder (taxes, business…) */}
        <div className="mb-5 rounded-xl border border-border bg-surface-2 p-3">
          <div className="mb-2 flex items-center gap-2">
            <FolderPlus size={15} className="text-text-muted" />
            <p className="text-sm font-semibold">Save to a folder</p>
            {folderId && (
              <button
                onClick={() => {
                  setFolderId(null);
                  setNewFolder("");
                }}
                className="ml-auto text-xs font-semibold text-negative"
              >
                Remove
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {folderData?.folders.map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  setFolderId(folderId === f.id ? null : f.id);
                  setNewFolder("");
                }}
                className="rounded-full px-3 py-1.5 text-xs font-semibold"
                style={{
                  background: folderId === f.id ? "var(--primary)" : "var(--surface)",
                  color: folderId === f.id ? "#fff" : "var(--text-muted)",
                  border: folderId === f.id ? "1px solid transparent" : "1px solid var(--border)",
                }}
              >
                {f.name}
              </button>
            ))}
            <input
              value={newFolder}
              onChange={(e) => {
                setNewFolder(e.target.value);
                if (e.target.value) setFolderId(null);
              }}
              placeholder="New folder… (e.g. Taxes 2026)"
              className="min-w-[150px] flex-1 rounded-full border border-border bg-surface px-3 py-1.5 text-xs outline-none focus:border-primary"
            />
          </div>
          <p className="mt-2 text-[11px] text-text-faint">
            For bookkeeping — find every saved charge, with its card and date, on the Folders
            screen at tax time.
          </p>
        </div>

        {/* Reimbursement — only for money-out */}
        {!isIncome && (
          <div className="mb-5 rounded-xl border border-border bg-surface-2 p-3">
            <button
              onClick={() => setOwedBack((v) => !v)}
              className="flex w-full items-center gap-3"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                <HandCoins size={18} />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-semibold">I&apos;m owed this back</p>
                <p className="text-xs text-text-muted">Nets out of spending once it&apos;s paid back</p>
              </div>
              <span
                className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
                style={{ background: owedBack ? "var(--primary)" : "var(--border)" }}
              >
                <span
                  className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all"
                  style={{ left: owedBack ? "22px" : "2px" }}
                />
              </span>
            </button>
            {owedBack && (
              <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                {reimbursed >= txn.amount ? (
                  <>
                    <span className="flex-1 text-sm font-medium text-positive">
                      Paid back in full
                    </span>
                    <button
                      onClick={() => setReimbursed(0)}
                      className="btn btn-ghost px-3 py-2 text-xs"
                    >
                      Undo
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm text-text-muted">
                      {reimbursed > 0
                        ? `${formatCurrency(reimbursed)} back · ${formatCurrency(txn.amount - reimbursed)} still owed`
                        : `You're owed ${formatCurrency(txn.amount)}`}
                    </span>
                    <button
                      onClick={() => setReimbursed(txn.amount)}
                      className="btn btn-primary px-3 py-2 text-xs"
                    >
                      Mark paid back
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <button
          onClick={save}
          disabled={saving}
          className="btn btn-primary w-full py-3"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
