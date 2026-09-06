"use client";

import Link from "next/link";
import {
  BarChart,
  Bar,
  XAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Briefcase } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Card } from "@/components/Section";
import { useApi } from "@/lib/client";
import { formatCurrency } from "@/lib/format";

interface BusinessData {
  configured: boolean;
  accounts: { id: string; name: string; mask: string | null; bank: string; balance: number }[];
  thisMonth: { label: string; income: number; expenses: number; net: number };
  months: { month: string; label: string; income: number; expenses: number; net: number }[];
  topExpenses: { name: string; total: number; count: number }[];
  recent: {
    id: string;
    date: string;
    name: string;
    amount: number;
    category: string | null;
    icon: string | null;
    color: string | null;
  }[];
}

export default function BusinessPage() {
  const { data } = useApi<BusinessData>("/api/business");

  if (!data) {
    return (
      <div>
        <PageHeader title="Business" />
        <div className="mx-5 h-60 animate-pulse rounded-2xl bg-surface-2" />
      </div>
    );
  }

  if (!data.configured) {
    return (
      <div>
        <PageHeader title="Business" subtitle="Your business's money, broken down" />
        <div className="mx-5 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-text-muted">
          <Briefcase size={22} className="mx-auto mb-2 text-text-faint" />
          No business accounts yet. On the{" "}
          <Link href="/accounts" className="font-semibold text-primary underline">
            Accounts
          </Link>{" "}
          screen, flip <b className="text-text">Business account</b> on for any account — its
          money then gets its own breakdown here (and stays out of your personal budget).
        </div>
      </div>
    );
  }

  const m = data.thisMonth;
  const pos = m.net >= 0;

  return (
    <div className="animate-in">
      <PageHeader
        title="Business"
        subtitle={data.accounts.map((a) => `${a.name}${a.mask ? ` ··${a.mask}` : ""}`).join(" · ")}
      />

      {/* Net profit hero */}
      <div className="mx-5 card p-5 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-faint">
          Net profit · {m.label}
        </p>
        <p
          className="mt-1 text-4xl font-bold tabular-nums tracking-tight"
          style={{ color: pos ? "var(--positive)" : "var(--negative)" }}
        >
          {pos ? "+" : "−"}
          {formatCurrency(Math.abs(m.net))}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3 text-center">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">
              Earned
            </p>
            <p className="text-lg font-bold tabular-nums text-positive">
              {formatCurrency(m.income, { compact: true })}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">
              Spent
            </p>
            <p className="text-lg font-bold tabular-nums">
              {formatCurrency(m.expenses, { compact: true })}
            </p>
          </div>
        </div>
      </div>

      {/* Profit by month */}
      <div className="mt-6">
        <h2 className="mb-2 px-5 text-sm font-semibold uppercase tracking-wide text-text-muted">
          Profit by month
        </h2>
        <div className="card mx-5 p-4" style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.months} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: "var(--text-faint)" }}
              />
              <Tooltip
                cursor={{ fill: "var(--surface-2)" }}
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  fontSize: 12,
                }}
                formatter={(v) => [formatCurrency(Number(v)), "Net"]}
              />
              <Bar dataKey="net" radius={[6, 6, 0, 0]}>
                {data.months.map((mo) => (
                  <Cell
                    key={mo.month}
                    fill={mo.net >= 0 ? "var(--positive)" : "var(--negative)"}
                    fillOpacity={0.85}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top expenses */}
      {data.topExpenses.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 px-5 text-sm font-semibold uppercase tracking-wide text-text-muted">
            Top expenses · {m.label}
          </h2>
          <Card>
            {data.topExpenses.map((e, i) => (
              <div key={e.name}>
                {i > 0 && <div className="mx-5 border-t border-border" />}
                <div className="flex items-center gap-3 px-5 py-3">
                  <span className="w-5 text-center text-sm font-bold text-text-faint">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{e.name}</p>
                    <p className="text-xs text-text-faint">
                      {e.count} charge{e.count > 1 ? "s" : ""}
                    </p>
                  </div>
                  <span className="font-semibold tabular-nums">{formatCurrency(e.total)}</span>
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}

      {/* Recent activity */}
      <div className="mt-6">
        <h2 className="mb-2 px-5 text-sm font-semibold uppercase tracking-wide text-text-muted">
          Recent business activity
        </h2>
        <Card>
          {data.recent.map((t, i) => (
            <div key={t.id}>
              {i > 0 && <div className="mx-5 border-t border-border" />}
              <div className="flex items-center gap-3 px-5 py-3">
                <CategoryIcon icon={t.icon ?? undefined} color={t.color ?? undefined} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{t.name}</p>
                  <p className="text-xs text-text-muted">
                    {t.category ?? "Uncategorized"} ·{" "}
                    {new Date(t.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </p>
                </div>
                <span
                  className="font-semibold tabular-nums"
                  style={{ color: t.amount < 0 ? "var(--positive)" : "var(--text)" }}
                >
                  {t.amount < 0 ? "+" : "-"}
                  {formatCurrency(Math.abs(t.amount))}
                </span>
              </div>
            </div>
          ))}
        </Card>
      </div>

      <p className="px-5 py-4 text-center text-[11px] text-text-faint">
        Business money stays out of your personal budget and hive — it lives here.
      </p>
    </div>
  );
}
