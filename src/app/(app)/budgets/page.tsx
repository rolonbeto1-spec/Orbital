"use client";

import { useState } from "react";
import { X, Trash2, Lock, Info, BellRing } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Card } from "@/components/Section";
import { RecurringCard } from "@/components/RecurringCard";
import { useApi, apiPost, apiPatch, apiDelete } from "@/lib/client";
import { formatCurrency } from "@/lib/format";

interface WantItem {
  categoryId: string | null;
  name: string;
  icon: string;
  color: string;
  budgetId: string | null;
  limit: number;
  spent: number;
  inBudget: boolean;
}
type FixedItem = WantItem;

/**
 * The shape /api/budget-overview actually returns.
 *
 * This page previously declared `{ fixed, wants }`, a shape from before the
 * budget model was rebuilt. `useApi<T>` only asserts the type, so nothing
 * caught the mismatch: `data.wants` was undefined at runtime and the page
 * crashed to a blank screen on every visit.
 */
interface Overview {
  month: string;
  inBudget: WantItem[];
  outOfBudget: FixedItem[];
  totals: { limit: number; spent: number; committed: number };
}

export default function BudgetsPage() {
  const { data, loading, refetch } = useApi<Overview>("/api/budget-overview");
  const [editing, setEditing] = useState<WantItem | null>(null);

  if (loading && !data) {
    return (
      <div>
        <PageHeader title="Budgets" />
        <div className="mx-5 h-64 animate-pulse rounded-2xl bg-surface-2" />
      </div>
    );
  }
  if (!data) return null;

  const { inBudget: wantItems, outOfBudget: fixedItems, totals } = data;
  const hasBudget = totals.limit > 0;
  const remaining = totals.limit - totals.spent;
  const over = remaining < 0;
  const pct = totals.limit > 0 ? Math.min((totals.spent / totals.limit) * 100, 100) : 0;

  return (
    <div>
      <PageHeader title="Budgets" subtitle={data.month} />

      {/* Wants budget hero — the real budget */}
      <div className="mx-5 card p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-text-muted">Wants budget</span>
          <span className="rounded-full bg-primary-soft px-2.5 py-1 text-[11px] font-semibold text-primary">
            What you control
          </span>
        </div>
        {hasBudget ? (
          <>
            <p className="mt-1 text-3xl font-bold tabular-nums">
              {formatCurrency(totals.spent)}{" "}
              <span className="text-lg font-semibold text-text-faint">
                / {formatCurrency(totals.limit)}
              </span>
            </p>
            <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${pct}%`,
                  background: over ? "var(--negative)" : "var(--primary)",
                }}
              />
            </div>
            <p className="mt-2 text-sm" style={{ color: over ? "var(--negative)" : "var(--text-muted)" }}>
              {over
                ? `${formatCurrency(-remaining)} over budget`
                : `${formatCurrency(remaining)} left to spend this month`}
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-text-muted">
            Set a limit on any Want below to start tracking your budget.
          </p>
        )}
      </div>

      {/* Explainer */}
      <div className="mx-5 mt-3 flex items-start gap-2 rounded-xl bg-surface-2 px-4 py-3 text-xs text-text-muted">
        <Info size={15} className="mt-0.5 shrink-0" />
        <p>
          Your budget only tracks <span className="font-semibold text-text">Wants</span> — the
          spending you can actually change. Fixed costs like rent and bills are shown below but
          aren&apos;t counted against your budget.
        </p>
      </div>

      {/* In-budget — editable */}
      <div className="mt-6">
        <h2 className="mb-2 px-5 text-sm font-semibold uppercase tracking-wide text-text-muted">
          In your budget · tap to set a limit
        </h2>
        <Card>
          {wantItems.map((it, i) => {
            const p = it.limit > 0 ? Math.min((it.spent / it.limit) * 100, 100) : 0;
            const itemOver = it.limit > 0 && it.spent > it.limit;
            return (
              <div key={it.name}>
                {i > 0 && <div className="mx-5 border-t border-border" />}
                <button
                  onClick={() => setEditing(it)}
                  className="flex w-full items-center gap-3 px-5 py-3 text-left active:bg-surface-2"
                >
                  <CategoryIcon icon={it.icon} color={it.color} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{it.name}</p>
                    {it.limit > 0 ? (
                      <>
                        <p className="text-xs text-text-muted tabular-nums">
                          {formatCurrency(it.spent)} of {formatCurrency(it.limit)}
                        </p>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${p}%`,
                              background: itemOver ? "var(--negative)" : it.color,
                            }}
                          />
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-text-faint tabular-nums">
                        {formatCurrency(it.spent)} spent · no limit set
                      </p>
                    )}
                  </div>
                  {it.limit > 0 && (
                    <span
                      className="shrink-0 text-sm font-semibold tabular-nums"
                      style={{ color: itemOver ? "var(--negative)" : "var(--text-muted)" }}
                    >
                      {itemOver
                        ? `${formatCurrency(it.spent - it.limit)} over`
                        : `${formatCurrency(it.limit - it.spent)} left`}
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </Card>
      </div>

      {/* Fixed / Needs — informational */}
      <div className="mt-6">
        <div className="mb-2 flex items-center gap-1.5 px-5">
          <Lock size={13} className="text-text-faint" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
            Fixed costs · {formatCurrency(totals.committed)}
          </h2>
        </div>
        <Card>
          {fixedItems.length === 0 ? (
            <p className="px-5 py-4 text-sm text-text-faint">No fixed costs yet this month.</p>
          ) : (
            fixedItems.map((it, i) => (
              <div key={it.name}>
                {i > 0 && <div className="mx-5 border-t border-border" />}
                <button
                  onClick={() => setEditing(it)}
                  className="flex w-full items-center gap-3 px-5 py-3 text-left active:bg-surface-2"
                >
                  <CategoryIcon icon={it.icon} color={it.color} size={36} />
                  <span className="flex-1 font-medium">{it.name}</span>
                  <span className="font-semibold tabular-nums text-text-muted">
                    {formatCurrency(it.spent)}
                  </span>
                </button>
              </div>
            ))
          )}
        </Card>
        <p className="px-5 pt-2 text-xs text-text-faint">
          Committed spending — not counted. Tap any category to pull it into your budget.
        </p>
      </div>

      <RemindersCard />

      <RecurringCard />

      <div className="h-4" />

      {editing && (
        <WantEditor
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refetch();
          }}
        />
      )}
    </div>
  );
}

// Customizable budget heads-ups — shown on the Home "Heads up" card.
function RemindersCard() {
  const { data, setData } = useApi<{ half: boolean; full: boolean; weekly: boolean }>(
    "/api/alert-prefs",
  );
  if (!data) return null;

  async function toggle(key: "half" | "full" | "weekly") {
    if (!data) return;
    const next = { ...data, [key]: !data[key] };
    setData(next);
    try {
      await apiPost("/api/alert-prefs", next);
    } catch {}
  }

  const ROWS: { key: "half" | "full" | "weekly"; title: string; sub: string }[] = [
    { key: "half", title: "Halfway mark", sub: "Tell me when I cross half my budget — early warning if it's too soon" },
    { key: "full", title: "Budget spent", sub: "Tell me the moment I go over" },
    { key: "weekly", title: "Weekly check-in", sub: "Split the month into weeks: “week 2 of 4, 48% used — on pace”" },
  ];

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center gap-1.5 px-5">
        <BellRing size={13} className="text-text-faint" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
          Budget reminders
        </h2>
      </div>
      <Card>
        {ROWS.map((r, i) => (
          <div key={r.key}>
            {i > 0 && <div className="mx-5 border-t border-border" />}
            <button
              onClick={() => toggle(r.key)}
              className="flex w-full items-center gap-3 px-5 py-3 text-left"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">{r.title}</p>
                <p className="text-xs text-text-muted">{r.sub}</p>
              </div>
              <span
                className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
                style={{ background: data[r.key] ? "var(--primary)" : "var(--border)" }}
              >
                <span
                  className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all"
                  style={{ left: data[r.key] ? 22 : 2 }}
                />
              </span>
            </button>
          </div>
        ))}
      </Card>
      <p className="px-5 pt-2 text-xs text-text-faint">
        Reminders show up in the Heads up card on Home. You can also just tell the assistant —
        &ldquo;remind me when I hit half my budget.&rdquo;
      </p>
    </div>
  );
}

function WantEditor({
  item,
  onClose,
  onSaved,
}: {
  item: WantItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(item.limit ? String(item.limit) : "");
  const [inBudget, setInBudget] = useState(item.inBudget);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!item.categoryId) return;
    setBusy(true);
    try {
      if (inBudget !== item.inBudget) {
        await apiPatch(`/api/categories/${item.categoryId}`, { inBudget });
      }
      const value = parseFloat(amount);
      if (inBudget && !isNaN(value) && value > 0) {
        await apiPost("/api/budgets", { categoryId: item.categoryId, amount: value });
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!item.budgetId) return onSaved();
    setBusy(true);
    try {
      await apiDelete(`/api/budgets/${item.budgetId}`);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-[480px] rounded-t-3xl bg-surface p-5 pb-8 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CategoryIcon icon={item.icon} color={item.color} />
            <div>
              <p className="text-lg font-bold">{item.name}</p>
              <p className="text-xs text-text-muted">Monthly limit</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full bg-surface-2 p-2">
            <X size={18} />
          </button>
        </div>

        {/* Customizable budget membership — the core of "what counts" */}
        <button
          onClick={() => setInBudget(!inBudget)}
          className="mb-3 flex w-full items-center justify-between rounded-xl border border-border bg-surface-2 px-4 py-3"
        >
          <span className="text-sm font-semibold">Counts in my budget</span>
          <span
            className="relative inline-block h-6 w-11 rounded-full transition-colors"
            style={{ background: inBudget ? "var(--primary)" : "var(--border)" }}
          >
            <span
              className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all"
              style={{ left: inBudget ? 22 : 2 }}
            />
          </span>
        </button>

        {inBudget ? (
          <div className="mb-2 flex items-center rounded-xl border border-border bg-surface-2 px-4 py-3">
            <span className="text-2xl font-bold text-text-muted">$</span>
            <input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              autoFocus
              className="w-full bg-transparent text-2xl font-bold outline-none"
            />
          </div>
        ) : (
          <p className="mb-2 rounded-xl bg-surface-2 px-4 py-3 text-sm text-text-muted">
            Tracked but not counted — spending here won&apos;t touch your budget.
          </p>
        )}
        <p className="mb-5 text-xs text-text-faint">
          Spent so far this month: {formatCurrency(item.spent)}
        </p>

        <div className="flex gap-3">
          {item.budgetId && (
            <button
              onClick={remove}
              disabled={busy}
              className="btn btn-ghost px-4 py-3"
              style={{ color: "var(--negative)" }}
            >
              <Trash2 size={18} />
            </button>
          )}
          <button
            onClick={save}
            disabled={busy || (inBudget === item.inBudget && !amount)}
            className="btn btn-primary flex-1 py-3"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
