"use client";

import { Repeat } from "lucide-react";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Card } from "@/components/Section";
import { useApi } from "@/lib/client";
import { formatCurrency } from "@/lib/format";
import type { RecurringCharge } from "@/lib/recurring";

const CADENCE_LABEL: Record<string, string> = {
  weekly: "weekly",
  biweekly: "every 2 weeks",
  monthly: "monthly",
};

function nextLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (days <= 0) return "due now";
  if (days === 1) return "tomorrow";
  if (days <= 14) return `in ${days} days`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function RecurringCard() {
  const { data } = useApi<{ recurring: RecurringCharge[]; monthlyTotal: number }>(
    "/api/recurring",
  );
  if (!data || data.recurring.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center gap-1.5 px-5">
        <Repeat size={13} className="text-text-faint" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
          On a schedule · {formatCurrency(data.monthlyTotal)}/mo
        </h2>
      </div>
      <Card>
        {data.recurring.map((r, i) => (
          <div key={r.merchant}>
            {i > 0 && <div className="mx-5 border-t border-border" />}
            <div className="flex items-center gap-3 px-5 py-3">
              <CategoryIcon
                icon={r.categoryIcon ?? undefined}
                color={r.categoryColor ?? undefined}
                size={36}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.merchant}</p>
                <p className="text-xs text-text-muted">
                  {formatCurrency(r.amount)} {CADENCE_LABEL[r.cadence]} · next{" "}
                  {nextLabel(r.nextExpected)}
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-text-muted">
                {formatCurrency(r.monthlyCost)}/mo
              </span>
            </div>
          </div>
        ))}
      </Card>
      <p className="px-5 pt-2 text-xs text-text-faint">
        Spotted automatically — charges that repeat on a regular schedule at a steady price.
      </p>
    </div>
  );
}
