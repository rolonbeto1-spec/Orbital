"use client";

import { useState } from "react";
import { Plus, X, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { GoalCard } from "@/components/GoalCard";
import { getIcon } from "@/lib/icons";
import { useApi, apiPost, apiPatch, apiDelete } from "@/lib/client";
import type { Goal } from "@/lib/types";

const GOAL_ICONS = ["Target", "PiggyBank", "Plane", "Home", "Car", "TrendingUp", "Wallet"];
const GOAL_COLORS = ["#6366f1", "#22c55e", "#f97316", "#ec4899", "#06b6d4", "#a855f7"];

export default function GoalsPage() {
  const { data, loading, refetch } = useApi<{ goals: Goal[] }>("/api/goals");
  const [editing, setEditing] = useState<Goal | "new" | null>(null);

  const goals = data?.goals ?? [];

  return (
    <div>
      <PageHeader
        title="Goals"
        subtitle="Savings targets"
        action={
          <button
            onClick={() => setEditing("new")}
            className="btn btn-primary h-10 w-10 rounded-full p-0"
          >
            <Plus size={20} />
          </button>
        }
      />

      {loading && !data ? (
        <div className="mx-5 h-40 animate-pulse rounded-2xl bg-surface-2" />
      ) : goals.length === 0 ? (
        <div className="mt-10 px-5 text-center">
          <p className="text-sm text-text-faint">No goals yet.</p>
          <button
            onClick={() => setEditing("new")}
            className="btn btn-primary mx-auto mt-4 px-5 py-2.5 text-sm"
          >
            <Plus size={18} /> Create your first goal
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 px-5">
          {goals.map((g) => (
            <GoalCard key={g.id} goal={g} onEdit={() => setEditing(g)} />
          ))}
        </div>
      )}

      {editing && (
        <GoalEditor
          goal={editing === "new" ? null : editing}
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

function GoalEditor({
  goal,
  onClose,
  onSaved,
}: {
  goal: Goal | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(goal ? String(goal.targetAmount) : "");
  const [current, setCurrent] = useState(goal ? String(goal.currentAmount) : "");
  const [icon, setIcon] = useState(goal?.icon ?? "Target");
  const [color, setColor] = useState(goal?.color ?? GOAL_COLORS[0]);
  const [busy, setBusy] = useState(false);

  async function save() {
    const targetAmount = parseFloat(target);
    const currentAmount = parseFloat(current) || 0;
    if (!name || isNaN(targetAmount) || targetAmount <= 0) return;
    setBusy(true);
    try {
      const body = { name, targetAmount, currentAmount, icon, color };
      if (goal) await apiPatch(`/api/goals/${goal.id}`, body);
      else await apiPost("/api/goals", body);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!goal) return;
    setBusy(true);
    try {
      await apiDelete(`/api/goals/${goal.id}`);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 max-h-[90dvh] w-full max-w-[480px] overflow-y-auto rounded-t-3xl bg-surface p-5 pb-8 shadow-lg animate-in">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-lg font-bold">{goal ? "Edit goal" : "New goal"}</p>
          <button onClick={onClose} className="rounded-full bg-surface-2 p-2">
            <X size={18} />
          </button>
        </div>

        <label className="mb-1 block text-sm font-semibold text-text-muted">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Emergency fund"
          className="mb-4 w-full rounded-xl border border-border bg-surface-2 p-3 outline-none focus:border-primary"
        />

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-semibold text-text-muted">Target</label>
            <div className="flex items-center rounded-xl border border-border bg-surface-2 px-3 py-3">
              <span className="font-bold text-text-muted">$</span>
              <input
                type="number"
                inputMode="decimal"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="0"
                className="w-full bg-transparent font-semibold outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-text-muted">Saved</label>
            <div className="flex items-center rounded-xl border border-border bg-surface-2 px-3 py-3">
              <span className="font-bold text-text-muted">$</span>
              <input
                type="number"
                inputMode="decimal"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                placeholder="0"
                className="w-full bg-transparent font-semibold outline-none"
              />
            </div>
          </div>
        </div>

        <label className="mb-2 block text-sm font-semibold text-text-muted">Icon</label>
        <div className="mb-4 flex flex-wrap gap-2">
          {GOAL_ICONS.map((ic) => {
            const Icon = getIcon(ic);
            const active = ic === icon;
            return (
              <button
                key={ic}
                onClick={() => setIcon(ic)}
                className="flex h-11 w-11 items-center justify-center rounded-xl border transition-colors"
                style={{
                  borderColor: active ? color : "var(--border)",
                  background: active ? `color-mix(in srgb, ${color} 16%, transparent)` : "var(--surface-2)",
                  color: active ? color : "var(--text-muted)",
                }}
              >
                <Icon size={20} />
              </button>
            );
          })}
        </div>

        <label className="mb-2 block text-sm font-semibold text-text-muted">Color</label>
        <div className="mb-6 flex gap-2">
          {GOAL_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className="h-9 w-9 rounded-full transition-transform"
              style={{
                background: c,
                outline: c === color ? `2px solid ${c}` : "none",
                outlineOffset: 2,
                transform: c === color ? "scale(1.1)" : "scale(1)",
              }}
            />
          ))}
        </div>

        <div className="flex gap-3">
          {goal && (
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
            disabled={busy || !name || !target}
            className="btn btn-primary flex-1 py-3"
          >
            {busy ? "Saving…" : "Save goal"}
          </button>
        </div>
      </div>
    </div>
  );
}
