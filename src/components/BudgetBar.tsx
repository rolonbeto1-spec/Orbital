import { CategoryIcon } from "@/components/CategoryIcon";
import { formatCurrency } from "@/lib/format";
import type { BudgetWithSpend } from "@/lib/types";

export function BudgetBar({ budget }: { budget: BudgetWithSpend }) {
  const pct = budget.limit > 0 ? Math.min((budget.spent / budget.limit) * 100, 100) : 0;
  const over = budget.spent > budget.limit;
  const remaining = budget.limit - budget.spent;
  const barColor = over ? "var(--negative)" : pct > 85 ? "#f59e0b" : budget.category.color;

  return (
    <div className="px-5 py-3">
      <div className="mb-2 flex items-center gap-3">
        <CategoryIcon
          icon={budget.category.icon}
          color={budget.category.color}
          size={34}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{budget.category.name}</p>
          <p className="text-xs text-text-muted tabular-nums">
            {formatCurrency(budget.spent)} of {formatCurrency(budget.limit)}
          </p>
        </div>
        <span
          className="shrink-0 text-sm font-semibold tabular-nums"
          style={{ color: over ? "var(--negative)" : "var(--text-muted)" }}
        >
          {over
            ? `${formatCurrency(-remaining)} over`
            : `${formatCurrency(remaining)} left`}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
    </div>
  );
}
