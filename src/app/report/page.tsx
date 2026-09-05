"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Repeat, Trophy, Building2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Card } from "@/components/Section";
import { useApi } from "@/lib/client";
import { formatCurrency } from "@/lib/format";

interface ReportCategory {
  name: string;
  icon: string;
  color: string;
  total: number;
  prevTotal: number;
  deltaPct: number | null;
  isWant: boolean;
}
interface Report {
  month: string;
  label: string;
  partial: boolean;
  income: number;
  spending: number;
  net: number;
  savingsRate: number | null;
  prev: { label: string; income: number; spending: number };
  categories: ReportCategory[];
  needsTotal: number;
  wantsTotal: number;
  topMerchants: { name: string; total: number; count: number }[];
  biggest: { name: string; amount: number; date: string; category: string | null } | null;
  wantsBudget: { budget: number; spent: number } | null;
  recurringMonthly: number;
  rentals: { net: number; count: number } | null;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function ReportPage() {
  const [month, setMonth] = useState(currentMonth());
  const url = useMemo(() => `/api/report?month=${month}`, [month]);
  const { data, loading } = useApi<Report>(url);
  const atCurrent = month === currentMonth();

  return (
    <div>
      <PageHeader title="Monthly report" subtitle="Your money, month by month" />

      {/* Month picker */}
      <div className="mx-5 flex items-center justify-between rounded-2xl border border-border bg-surface px-2 py-1.5">
        <button
          onClick={() => setMonth((m) => shiftMonth(m, -1))}
          className="rounded-full p-2 active:bg-surface-2"
          aria-label="Previous month"
        >
          <ChevronLeft size={20} />
        </button>
        <span className="font-bold">
          {data?.label ?? "…"}
          {data?.partial && (
            <span className="ml-1.5 rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-primary">
              so far
            </span>
          )}
        </span>
        <button
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
          disabled={atCurrent}
          className="rounded-full p-2 active:bg-surface-2 disabled:opacity-30"
          aria-label="Next month"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {loading && !data ? (
        <div className="mx-5 mt-4 h-72 animate-pulse rounded-2xl bg-surface-2" />
      ) : !data ? null : (
        <div className="animate-in">
          {/* Hero: in / out / kept */}
          <div className="mx-5 mt-4 card p-5">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">
                  Came in
                </p>
                <p className="mt-1 text-lg font-bold tabular-nums text-positive">
                  {formatCurrency(data.income, { compact: true })}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">
                  Went out
                </p>
                <p className="mt-1 text-lg font-bold tabular-nums">
                  {formatCurrency(data.spending, { compact: true })}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">
                  You kept
                </p>
                <p
                  className="mt-1 text-lg font-bold tabular-nums"
                  style={{ color: data.net >= 0 ? "var(--positive)" : "var(--negative)" }}
                >
                  {data.net >= 0 ? "" : "−"}
                  {formatCurrency(Math.abs(data.net), { compact: true })}
                </p>
              </div>
            </div>
            {data.savingsRate != null && (
              <p className="mt-3 border-t border-border pt-3 text-center text-sm text-text-muted">
                {data.savingsRate >= 0 ? (
                  <>
                    You kept <b className="text-text">{data.savingsRate}%</b> of what you made
                    {data.partial ? " so far this month." : ` in ${data.label.split(" ")[0]}.`}
                  </>
                ) : (
                  <>You spent more than you made{data.partial ? " so far this month." : ` in ${data.label.split(" ")[0]}.`}</>
                )}
              </p>
            )}
            {data.prev.spending > 0 && (
              <p className="mt-1 text-center text-xs text-text-faint">
                {data.prev.label}: {formatCurrency(data.prev.income, { compact: true })} in ·{" "}
                {formatCurrency(data.prev.spending, { compact: true })} out
              </p>
            )}
          </div>

          {/* Needs vs Wants split */}
          {data.spending > 0 && (
            <div className="mx-5 mt-3 card p-4">
              <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
                <i
                  style={{
                    width: `${(data.needsTotal / data.spending) * 100}%`,
                    background: "var(--needs)",
                  }}
                />
                <i
                  style={{
                    width: `${(data.wantsTotal / data.spending) * 100}%`,
                    background: "var(--wants)",
                  }}
                />
              </div>
              <div className="mt-2 flex justify-between text-xs font-semibold">
                <span className="flex items-center gap-1.5">
                  <i className="h-2 w-2 rounded-full" style={{ background: "var(--needs)" }} />
                  <span className="text-text-muted">Needs</span>{" "}
                  <b className="tabular-nums">{formatCurrency(data.needsTotal, { compact: true })}</b>
                </span>
                <span className="flex items-center gap-1.5">
                  <i className="h-2 w-2 rounded-full" style={{ background: "var(--wants)" }} />
                  <span className="text-text-muted">Wants</span>{" "}
                  <b className="tabular-nums">{formatCurrency(data.wantsTotal, { compact: true })}</b>
                </span>
              </div>
            </div>
          )}

          {/* Wants budget result */}
          {data.wantsBudget && (
            <div className="mx-5 mt-3 card p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">Wants budget</span>
                <span
                  className="font-bold tabular-nums"
                  style={{
                    color:
                      data.wantsBudget.spent <= data.wantsBudget.budget
                        ? "var(--positive)"
                        : "var(--negative)",
                  }}
                >
                  {data.wantsBudget.spent <= data.wantsBudget.budget
                    ? `${formatCurrency(data.wantsBudget.budget - data.wantsBudget.spent)} under`
                    : `${formatCurrency(data.wantsBudget.spent - data.wantsBudget.budget)} over`}
                </span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min((data.wantsBudget.spent / data.wantsBudget.budget) * 100, 100)}%`,
                    background:
                      data.wantsBudget.spent <= data.wantsBudget.budget
                        ? "var(--primary)"
                        : "var(--negative)",
                  }}
                />
              </div>
              <p className="mt-1.5 text-xs text-text-faint tabular-nums">
                {formatCurrency(data.wantsBudget.spent)} of {formatCurrency(data.wantsBudget.budget)}
              </p>
            </div>
          )}

          {/* Where it went */}
          {data.categories.length > 0 && (
            <div className="mt-6">
              <h2 className="mb-2 px-5 text-sm font-semibold uppercase tracking-wide text-text-muted">
                Where it went
              </h2>
              <Card>
                {data.categories.map((c, i) => (
                  <div key={c.name}>
                    {i > 0 && <div className="mx-5 border-t border-border" />}
                    <div className="flex items-center gap-3 px-5 py-3">
                      <CategoryIcon icon={c.icon} color={c.color} size={36} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{c.name}</p>
                        <p className="text-xs text-text-faint">
                          {c.isWant ? "Want" : "Need"}
                          {c.prevTotal > 0 &&
                            ` · ${formatCurrency(c.prevTotal)} in ${data.prev.label}`}
                        </p>
                      </div>
                      {c.deltaPct != null && c.deltaPct !== 0 && (
                        <span
                          className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums"
                          style={{
                            color: c.deltaPct < 0 ? "var(--positive)" : "var(--negative)",
                            background: `color-mix(in srgb, ${
                              c.deltaPct < 0 ? "var(--positive)" : "var(--negative)"
                            } 14%, transparent)`,
                          }}
                        >
                          {c.deltaPct > 0 ? "▲" : "▼"} {Math.abs(c.deltaPct)}%
                        </span>
                      )}
                      <span className="shrink-0 font-semibold tabular-nums">
                        {formatCurrency(c.total)}
                      </span>
                    </div>
                  </div>
                ))}
              </Card>
            </div>
          )}

          {/* Top merchants */}
          {data.topMerchants.length > 0 && (
            <div className="mt-6">
              <h2 className="mb-2 px-5 text-sm font-semibold uppercase tracking-wide text-text-muted">
                Top merchants
              </h2>
              <Card>
                {data.topMerchants.map((m, i) => (
                  <div key={m.name}>
                    {i > 0 && <div className="mx-5 border-t border-border" />}
                    <div className="flex items-center gap-3 px-5 py-3">
                      <span className="w-5 text-center text-sm font-bold text-text-faint">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{m.name}</p>
                        <p className="text-xs text-text-faint">
                          {m.count} purchase{m.count > 1 ? "s" : ""}
                        </p>
                      </div>
                      <span className="font-semibold tabular-nums">{formatCurrency(m.total)}</span>
                    </div>
                  </div>
                ))}
              </Card>
            </div>
          )}

          {/* Standouts */}
          <div className="mx-5 mt-6 space-y-3">
            {data.biggest && (
              <div className="card flex items-center gap-3 p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                  <Trophy size={17} />
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold">Biggest purchase</p>
                  <p className="text-xs text-text-muted">
                    {data.biggest.name}
                    {data.biggest.category ? ` · ${data.biggest.category}` : ""}
                  </p>
                </div>
                <span className="font-bold tabular-nums">
                  {formatCurrency(data.biggest.amount)}
                </span>
              </div>
            )}
            {data.recurringMonthly > 0 && (
              <div className="card flex items-center gap-3 p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                  <Repeat size={17} />
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold">On a schedule</p>
                  <p className="text-xs text-text-muted">Subscriptions & repeating bills</p>
                </div>
                <span className="font-bold tabular-nums">
                  {formatCurrency(data.recurringMonthly)}/mo
                </span>
              </div>
            )}
            {data.rentals && (
              <div className="card flex items-center gap-3 p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                  <Building2 size={17} />
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold">Rentals</p>
                  <p className="text-xs text-text-muted">
                    {data.rentals.count} propert{data.rentals.count > 1 ? "ies" : "y"} · monthly net
                  </p>
                </div>
                <span
                  className="font-bold tabular-nums"
                  style={{
                    color: data.rentals.net >= 0 ? "var(--positive)" : "var(--negative)",
                  }}
                >
                  {data.rentals.net >= 0 ? "+" : "−"}
                  {formatCurrency(Math.abs(data.rentals.net))}
                </span>
              </div>
            )}
          </div>

          <div className="h-6" />
        </div>
      )}
    </div>
  );
}
