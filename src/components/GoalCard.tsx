import { getIcon } from "@/lib/icons";
import { formatCurrency } from "@/lib/format";
import type { Goal } from "@/lib/types";

function pct(goal: Goal) {
  return goal.targetAmount > 0
    ? Math.min((goal.currentAmount / goal.targetAmount) * 100, 100)
    : 0;
}

// Compact card for horizontal scroll on the dashboard.
export function GoalCardMini({ goal }: { goal: Goal }) {
  const Icon = getIcon(goal.icon);
  const p = pct(goal);
  return (
    <div className="card w-40 shrink-0 p-4">
      <div
        className="flex h-9 w-9 items-center justify-center rounded-full"
        style={{
          background: `color-mix(in srgb, ${goal.color} 16%, transparent)`,
          color: goal.color,
        }}
      >
        <Icon size={18} />
      </div>
      <p className="mt-2 truncate text-sm font-semibold">{goal.name}</p>
      <p className="text-xs text-text-muted tabular-nums">
        {formatCurrency(goal.currentAmount, { compact: true })} /{" "}
        {formatCurrency(goal.targetAmount, { compact: true })}
      </p>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full"
          style={{ width: `${p}%`, background: goal.color }}
        />
      </div>
    </div>
  );
}

// Full-width card for the goals page.
export function GoalCard({
  goal,
  onEdit,
}: {
  goal: Goal;
  onEdit?: () => void;
}) {
  const Icon = getIcon(goal.icon);
  const p = pct(goal);
  const remaining = goal.targetAmount - goal.currentAmount;
  return (
    <button
      onClick={onEdit}
      className="card w-full p-4 text-left transition-colors active:bg-surface-2"
    >
      <div className="flex items-center gap-3">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-full"
          style={{
            background: `color-mix(in srgb, ${goal.color} 16%, transparent)`,
            color: goal.color,
          }}
        >
          <Icon size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{goal.name}</p>
          <p className="text-xs text-text-muted tabular-nums">
            {remaining > 0
              ? `${formatCurrency(remaining)} to go`
              : "Goal reached 🎉"}
          </p>
        </div>
        <span className="text-sm font-bold tabular-nums" style={{ color: goal.color }}>
          {Math.round(p)}%
        </span>
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${p}%`, background: goal.color }}
        />
      </div>
      <div className="mt-2 flex justify-between text-xs text-text-muted tabular-nums">
        <span>{formatCurrency(goal.currentAmount)}</span>
        <span>{formatCurrency(goal.targetAmount)}</span>
      </div>
    </button>
  );
}
