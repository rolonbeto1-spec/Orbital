"use client";

import { useState } from "react";
import { ChevronLeft, FolderOpen, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Card } from "@/components/Section";
import { useApi, apiDelete } from "@/lib/client";
import { formatCurrency } from "@/lib/format";
import type { Transaction } from "@/lib/types";

interface FolderRow {
  id: string;
  name: string;
  count: number;
  total: number;
}
interface FolderDetail {
  id: string;
  name: string;
  transactions: Transaction[];
}

function monthLabel(date: string) {
  return new Date(date).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
function dayLabel(date: string) {
  return new Date(date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function FoldersPage() {
  const { data, refetch } = useApi<{ folders: FolderRow[] }>("/api/folders");
  const [openId, setOpenId] = useState<string | null>(null);

  if (openId) {
    return (
      <FolderView
        id={openId}
        onBack={() => {
          setOpenId(null);
          refetch();
        }}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Folders"
        subtitle="Saved charges — taxes, business, projects"
      />
      {!data ? (
        <div className="mx-5 h-40 animate-pulse rounded-2xl bg-surface-2" />
      ) : data.folders.length === 0 ? (
        <div className="mx-5 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-text-muted">
          <FolderOpen size={22} className="mx-auto mb-2 text-text-faint" />
          No folders yet. Open any transaction and choose{" "}
          <b className="text-text">Save to a folder</b> — like &ldquo;Taxes 2026&rdquo; — and
          it&apos;ll be waiting here, with the card and date, when you need it.
        </div>
      ) : (
        <Card>
          {data.folders.map((f, i) => (
            <div key={f.id}>
              {i > 0 && <div className="mx-5 border-t border-border" />}
              <button
                onClick={() => setOpenId(f.id)}
                className="flex w-full items-center gap-3 px-5 py-3.5 text-left active:bg-surface-2"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft text-primary">
                  <FolderOpen size={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{f.name}</span>
                  <span className="block text-xs text-text-faint">
                    {f.count} charge{f.count === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="font-bold tabular-nums">{formatCurrency(f.total)}</span>
              </button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function FolderView({ id, onBack }: { id: string; onBack: () => void }) {
  const { data } = useApi<FolderDetail>(`/api/folders/${id}`);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      await apiDelete(`/api/folders/${id}`);
      onBack();
    } finally {
      setBusy(false);
    }
  }

  // Group by month — that's how you'll look for them at tax time.
  const groups: { label: string; items: Transaction[] }[] = [];
  for (const t of data?.transactions ?? []) {
    const label = monthLabel(t.date);
    const g = groups.find((x) => x.label === label);
    if (g) g.items.push(t);
    else groups.push({ label, items: [t] });
  }
  const total = (data?.transactions ?? []).reduce((s, t) => s + Math.max(0, t.amount), 0);

  return (
    <div>
      <div className="flex items-center justify-between px-5 pb-2 pt-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm font-semibold text-primary"
        >
          <ChevronLeft size={17} /> Folders
        </button>
        <button
          onClick={remove}
          disabled={busy}
          className="flex items-center gap-1 text-xs font-semibold text-negative"
        >
          <Trash2 size={13} /> Delete folder
        </button>
      </div>
      <div className="px-5 pb-4">
        <h1 className="text-2xl font-bold tracking-tight">{data?.name ?? "…"}</h1>
        <p className="mt-0.5 text-sm text-text-muted">
          {data?.transactions.length ?? 0} saved charges ·{" "}
          <b className="tabular-nums text-text">{formatCurrency(total)}</b> total
        </p>
      </div>

      {groups.map((g) => (
        <div key={g.label} className="mb-4">
          <p className="px-5 pb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
            {g.label}
          </p>
          <Card>
            {g.items.map((t, i) => (
              <div key={t.id}>
                {i > 0 && <div className="mx-5 border-t border-border" />}
                <div className="flex items-center gap-3 px-5 py-3">
                  <CategoryIcon icon={t.category?.icon} color={t.category?.color} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{t.merchantName || t.name}</p>
                    <p className="truncate text-xs text-text-muted">
                      {dayLabel(t.date)}
                      {t.account ? ` · ${t.account.name}${t.account.mask ? ` ··${t.account.mask}` : ""}` : ""}
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums">
                    {formatCurrency(Math.abs(t.amount))}
                  </span>
                </div>
              </div>
            ))}
          </Card>
        </div>
      ))}
      {data && data.transactions.length === 0 && (
        <p className="px-5 text-sm text-text-faint">Nothing saved here yet.</p>
      )}
    </div>
  );
}
