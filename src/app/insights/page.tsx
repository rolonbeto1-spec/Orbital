"use client";

import { useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  Tooltip,
  Legend,
} from "recharts";
import Link from "next/link";
import { FileText } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { CategoryIcon } from "@/components/CategoryIcon";
import { RecurringPanel } from "@/components/RecurringPanel";
import { useApi } from "@/lib/client";
import { formatCurrency } from "@/lib/format";
import type { Cashflow, NetWorth, SpendSlice } from "@/lib/types";

interface InsightsData {
  cashflow: Cashflow;
  byCategory: SpendSlice[];
  trend: { month: string; label: string; income: number; spending: number }[];
  netWorth: NetWorth;
  month: string;
}

export default function InsightsPage() {
  const { data, loading } = useApi<InsightsData>("/api/insights");
  const [tab, setTab] = useState<"overview" | "recurring">("overview");

  if (loading && !data) {
    return (
      <div>
        <PageHeader title="Insights" />
        <div className="mx-5 h-64 animate-pulse rounded-2xl bg-surface-2" />
      </div>
    );
  }
  if (!data) return null;

  const totalSpend = data.byCategory.reduce((s, c) => s + c.total, 0);
  const savingsRate =
    data.cashflow.income > 0
      ? Math.round((data.cashflow.net / data.cashflow.income) * 100)
      : 0;

  return (
    <div className="animate-in">
      <PageHeader
        title="Insights"
        subtitle={data.month}
        action={
          <Link
            href="/report"
            className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-muted active:scale-95"
          >
            <FileText size={13} />
            Monthly report
          </Link>
        }
      />

      {/* tabs */}
      <div className="flex gap-2 px-5 pb-4 pt-1">
        {(
          [
            ["overview", "Overview"],
            ["recurring", "Recurring"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="rounded-full px-4 py-1.5 text-xs font-semibold transition-colors active:scale-95"
            style={
              tab === key
                ? { background: "var(--primary)", color: "#fff" }
                : {
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                    color: "var(--text-muted)",
                  }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "recurring" ? (
        <RecurringPanel />
      ) : (
        <>
      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3 px-5">
        <Stat label="Net worth" value={formatCurrency(data.netWorth.netWorth, { compact: true })} />
        <Stat
          label="Savings rate"
          value={`${savingsRate}%`}
          color={savingsRate >= 0 ? "var(--positive)" : "var(--negative)"}
        />
      </div>

      {/* Spending by category donut */}
      <div className="mt-6">
        <h2 className="mb-2 px-5 text-sm font-semibold uppercase tracking-wide text-text-muted">
          Where your money went
        </h2>
        <div className="mx-5 card p-4">
          {totalSpend === 0 ? (
            <p className="py-10 text-center text-sm text-text-faint">
              No spending recorded this month.
            </p>
          ) : (
            <>
              <div className="relative h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.byCategory}
                      dataKey="total"
                      nameKey="name"
                      innerRadius={65}
                      outerRadius={95}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {data.byCategory.map((c) => (
                        <Cell key={c.categoryId} fill={c.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v) => formatCurrency(Number(v))}
                      contentStyle={{
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        color: "var(--text)",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xs text-text-muted">Total</span>
                  <span className="text-xl font-bold tabular-nums">
                    {formatCurrency(totalSpend, { compact: true })}
                  </span>
                </div>
              </div>

              {/* Legend list */}
              <div className="mt-3 flex flex-col gap-2">
                {data.byCategory.map((c) => {
                  const pct = Math.round((c.total / totalSpend) * 100);
                  const delta = c.pct ?? 0;
                  const flat = Math.abs(delta) < 3;
                  const spendingDown = delta < 0; // less spending = good
                  return (
                    <div key={c.categoryId} className="flex items-center gap-3">
                      <CategoryIcon icon={c.icon} color={c.color} size={30} />
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{c.name}</span>
                        {!flat && (
                          <span
                            className="text-[11px] font-bold"
                            style={{ color: spendingDown ? "var(--positive)" : "var(--negative)" }}
                          >
                            {spendingDown ? "▼" : "▲"} {Math.abs(delta)}% vs last month
                          </span>
                        )}
                      </div>
                      <span className="text-sm text-text-muted tabular-nums">{pct}%</span>
                      <span className="w-20 text-right text-sm font-semibold tabular-nums">
                        {formatCurrency(c.total)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Income vs spending trend */}
      <div className="mt-6">
        <h2 className="mb-2 px-5 text-sm font-semibold uppercase tracking-wide text-text-muted">
          Income vs spending
        </h2>
        <div className="mx-5 card p-4">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.trend} barCategoryGap="20%">
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "var(--text-muted)", fontSize: 12 }}
                />
                <Tooltip
                  cursor={{ fill: "var(--surface-2)" }}
                  formatter={(v) => formatCurrency(Number(v))}
                  contentStyle={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    color: "var(--text)",
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 12, color: "var(--text-muted)" }}
                  iconType="circle"
                />
                <Bar dataKey="income" name="Income" fill="#22c55e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="spending" name="Spending" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="h-4" />
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color }}>
        {value}
      </p>
    </div>
  );
}
