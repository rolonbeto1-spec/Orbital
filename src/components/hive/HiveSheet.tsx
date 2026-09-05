"use client";

import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { getIcon } from "@/lib/icons";
import { formatCurrency } from "@/lib/format";
import { NEEDS_CATEGORIES } from "@/lib/buckets";
import { AccountFilter, ALL_ACCOUNTS, scopeParams, type AccountScope } from "@/components/AccountFilter";
import type { HiveBranch, HiveItem } from "@/lib/hive";
import type { HiveData, HiveSelection } from "@/components/hive/HiveCanvas";
import type { Transaction } from "@/lib/types";

const BRANCH_COLOR: Record<string, string> = {
  needs: "var(--needs)",
  wants: "var(--wants)",
  invest: "var(--invest)",
  rentals: "var(--rentals)",
};

function HexIcon({ icon, color, size = 44 }: { icon: string; color: string; size?: number }) {
  const Icon = icon === "Wallet" ? Wallet : getIcon(icon);
  return (
    <div
      className="flex shrink-0 items-center justify-center"
      style={{
        width: size,
        height: size,
        clipPath: "var(--hex)",
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
        color,
      }}
    >
      <Icon size={size * 0.45} />
    </div>
  );
}

function selectionKey(sel: HiveSelection | null): string {
  if (!sel) return "none";
  if (sel.type === "overview") return "overview";
  if (sel.type === "budget") return "budget";
  if (sel.type === "branch") return `b:${sel.branch.id}`;
  return `i:${sel.item.id}`;
}

function dayLabel(date: string) {
  return new Date(date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// Maps the hive's window spec to transaction-list query params, so the
// purchase timelines show the same span you picked for the hive.
function windowParams(spec: string | null | undefined, p: URLSearchParams) {
  const m = spec?.match(/^month:(.+)$/);
  if (m) p.set("month", m[1]);
  else if (spec === "month") {
    const now = new Date();
    p.set("month", `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  } else if (spec === "week") p.set("days", "7");
  else p.set("days", "35");
  return p;
}

export function HiveSheet({
  selection,
  data,
  windowSpec,
  onClose,
  onSelect,
}: {
  selection: HiveSelection | null;
  data: HiveData;
  windowSpec?: string | null;
  onClose: () => void;
  onSelect: (sel: HiveSelection) => void;
}) {
  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] transition-opacity duration-300 ${selection ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={onClose}
      />
      <div
        className={`fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[78dvh] w-full max-w-[480px] overflow-y-auto rounded-t-3xl border-t border-border bg-surface p-5 pb-8 shadow-lg transition-transform duration-[380ms] ${selection ? "translate-y-0" : "translate-y-full"}`}
        style={{ transitionTimingFunction: "cubic-bezier(.32,.72,.24,1)" }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
        {/* keyed remount so switching overview → branch → item crossfades */}
        <div key={selectionKey(selection)} className="sheet-in">
          {selection?.type === "budget" && <BudgetDetail data={data} />}
          {selection?.type === "overview" && <Overview data={data} onSelect={onSelect} />}
          {selection?.type === "branch" && (
            <BranchDetail branch={selection.branch} data={data} onSelect={onSelect} />
          )}
          {selection?.type === "item" && (
            <ItemDetail
              branch={selection.branch}
              item={selection.item}
              windowSpec={windowSpec}
              windowLabel={data.windowLabel}
            />
          )}
        </div>
      </div>
    </>
  );
}

function SheetHead({
  icon,
  color,
  title,
  sub,
  amount,
}: {
  icon: string;
  color: string;
  title: string;
  sub?: string;
  amount?: string;
}) {
  return (
    <div className="mb-2 flex items-center gap-3">
      <HexIcon icon={icon} color={color} />
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-bold leading-tight">{title}</h2>
        {sub && <p className="text-xs text-text-muted">{sub}</p>}
      </div>
      {amount && <span className="text-lg font-extrabold tabular-nums">{amount}</span>}
    </div>
  );
}

function BudgetDetail({ data }: { data: HiveData }) {
  const b = data.budget;
  const over = b.hasBudget && b.left < 0;
  const pct = b.hasBudget ? Math.min((b.spent / b.limit) * 100, 100) : 0;
  return (
    <div>
      <SheetHead
        icon="PiggyBank"
        color="var(--primary)"
        title="Budget"
        sub="This month · only what you chose to count"
        amount={
          b.hasBudget
            ? `${over ? "−" : ""}${formatCurrency(Math.abs(b.left), { compact: true })}`
            : formatCurrency(b.spent, { compact: true })
        }
      />
      {b.hasBudget ? (
        <>
          <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full"
              style={{
                width: `${pct}%`,
                background: over ? "var(--negative)" : "var(--primary)",
              }}
            />
          </div>
          <p
            className="mt-1.5 text-sm"
            style={{ color: over ? "var(--negative)" : "var(--text-muted)" }}
          >
            {over
              ? `${formatCurrency(-b.left)} over — ${formatCurrency(b.spent)} spent of ${formatCurrency(b.limit)}`
              : `${formatCurrency(b.spent)} spent of ${formatCurrency(b.limit)} · ${formatCurrency(b.left)} left`}
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm text-text-muted">
          No limits set yet — set one on any category below to start the countdown.
        </p>
      )}
      <div className="mt-3">
        {b.categories.map((c) => (
          <div key={c.categoryId} className="flex items-center gap-3 border-t border-border py-2.5">
            <HexIcon icon={c.icon} color={c.color} size={30} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{c.name}</p>
              {c.limit > 0 && (
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min((c.spent / c.limit) * 100, 100)}%`,
                      background: c.spent > c.limit ? "var(--negative)" : c.color,
                    }}
                  />
                </div>
              )}
            </div>
            <span className="shrink-0 text-sm font-bold tabular-nums">
              {formatCurrency(c.spent)}
              {c.limit > 0 && (
                <span className="font-semibold text-text-faint"> / {formatCurrency(c.limit)}</span>
              )}
            </span>
          </div>
        ))}
      </div>
      <a
        href="/budgets"
        className="mt-4 block rounded-xl bg-surface-2 px-4 py-3 text-center text-sm font-semibold text-primary"
      >
        Set limits & choose what counts →
      </a>
      <p className="mt-2 text-[11px] text-text-faint">
        Bills and fixed costs stay out of the budget unless you add them. Change any category on
        the Budgets tab.
      </p>
    </div>
  );
}

function Overview({ data, onSelect }: { data: HiveData; onSelect: (s: HiveSelection) => void }) {
  return (
    <div>
      <SheetHead
        icon="Wallet"
        color="var(--primary)"
        title="Your money"
        sub={`Truly available ${formatCurrency(data.money.trueAvailable, { compact: true })} after cards`}
        amount={formatCurrency(data.money.total, { compact: true })}
      />
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
        Where it flows · {data.windowLabel}
      </p>
      <div className="mt-2">
        {data.branches.map((b) => (
          <button
            key={b.id}
            onClick={() => onSelect({ type: "branch", branch: b })}
            className="flex w-full items-center gap-3 border-t border-border py-2.5 text-left"
          >
            <HexIcon icon={b.icon} color={BRANCH_COLOR[b.id]} size={32} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{b.label}</p>
              <p className="text-[11px] text-text-faint">{b.blurb}</p>
            </div>
            <div className="text-right">
              <p className="font-bold tabular-nums">{formatCurrency(b.value, { compact: true })}</p>
              <p className="text-[11px] font-semibold text-text-faint">{b.pct}%</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function BranchDetail({
  branch,
  onSelect,
}: {
  branch: HiveBranch;
  data: HiveData;
  onSelect: (s: HiveSelection) => void;
}) {
  const color = BRANCH_COLOR[branch.id];
  return (
    <div>
      <SheetHead
        icon={branch.icon}
        color={color}
        title={branch.label}
        sub={`${branch.blurb} · ${branch.pct}% of flow`}
        amount={formatCurrency(branch.value, { compact: true })}
      />
      <div className="mt-2">
        {branch.items.map((it) => (
          <button
            key={it.id}
            onClick={() => onSelect({ type: "item", branch, item: it })}
            className="flex w-full items-center gap-3 border-t border-border py-2.5 text-left"
          >
            <HexIcon icon={it.icon} color={color} size={30} />
            <span className="min-w-0 flex-1 truncate font-semibold">{it.name}</span>
            {it.trendPct != null && (
              <span
                className="text-[11px] font-bold"
                style={{ color: it.trendGood ? "var(--positive)" : "var(--negative)" }}
              >
                {it.trendPct > 0 ? "▲" : "▼"} {Math.abs(it.trendPct)}%
              </span>
            )}
            <span className="font-bold tabular-nums">
              {formatCurrency(it.balance ?? it.value)}
            </span>
          </button>
        ))}
        {branch.items.length === 0 && (
          <p className="border-t border-border py-4 text-sm text-text-faint">
            Nothing here yet.
          </p>
        )}
      </div>
    </div>
  );
}

function ItemDetail({
  branch,
  item,
  windowSpec,
  windowLabel,
}: {
  branch: HiveBranch;
  item: HiveItem;
  windowSpec?: string | null;
  windowLabel: string;
}) {
  const color = BRANCH_COLOR[branch.id];

  if (item.kind === "property" && item.property) {
    const p = item.property;
    const pos = p.net >= 0;
    return (
      <div>
        <SheetHead icon="Home" color={color} title={item.name} sub="Monthly profit / loss" />
        <div className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[15px]">
          <span className="text-text-muted">Rental income</span>
          <span className="text-right font-semibold tabular-nums text-positive">
            +{formatCurrency(p.rentIncome)}
          </span>
          <span className="text-text-muted">Mortgage</span>
          <span className="text-right font-semibold tabular-nums">−{formatCurrency(p.mortgage)}</span>
          <span className="text-text-muted">Utilities</span>
          <span className="text-right font-semibold tabular-nums">−{formatCurrency(p.utilities)}</span>
          {p.hoa > 0 && (
            <>
              <span className="text-text-muted">HOA</span>
              <span className="text-right font-semibold tabular-nums">−{formatCurrency(p.hoa)}</span>
            </>
          )}
          <span className="mt-1 border-t border-border pt-2 text-[17px] text-text-muted">
            {pos ? "Profit" : "You cover"}
          </span>
          <span
            className="mt-1 border-t border-border pt-2 text-right text-[17px] font-bold tabular-nums"
            style={{ color: pos ? "var(--positive)" : "var(--negative)" }}
          >
            {pos ? "+" : "−"}
            {formatCurrency(Math.abs(p.net))}
          </span>
        </div>
        {(p.sweatIn > 0 || p.sweatOut > 0) && (
          <div
            className="mt-4 rounded-xl border px-3.5 py-3 text-[13px]"
            style={{
              background: "color-mix(in srgb, var(--rentals) 12%, transparent)",
              borderColor: "color-mix(in srgb, var(--rentals) 28%, transparent)",
            }}
          >
            <b>Sweat equity</b> · put in {formatCurrency(p.sweatIn, { compact: true })} · gotten
            out {formatCurrency(p.sweatOut, { compact: true })} ·{" "}
            <b style={{ color: p.sweatOut - p.sweatIn >= 0 ? "var(--positive)" : "var(--negative)" }}>
              {formatCurrency(Math.abs(p.sweatOut - p.sweatIn), { compact: true })}{" "}
              {p.sweatOut - p.sweatIn >= 0 ? "ahead" : "behind"}
            </b>
          </div>
        )}
        <p className="mt-3 text-[13px] text-text-muted">
          {pos
            ? "Tenants cover the mortgage and utilities — this one pays you."
            : "Rent doesn't fully cover it — you're topping it up each month."}
        </p>
      </div>
    );
  }

  if (item.kind === "account") {
    return <AccountDetail item={item} color={color} />;
  }

  return (
    <CategoryTimeline
      branch={branch}
      item={item}
      color={color}
      windowSpec={windowSpec}
      windowLabel={windowLabel}
    />
  );
}

interface Holding {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  price: number;
  value: number;
  kind: string;
}

const KIND_ICON: Record<string, string> = {
  crypto: "Bitcoin",
  etf: "ChartPie",
  stock: "TrendingUp",
  cash: "Wallet",
};

function AccountDetail({ item, color }: { item: HiveItem; color: string }) {
  const accountId = item.id.replace(/^acct:/, "");
  const [holdings, setHoldings] = useState<Holding[] | null>(null);

  if (item.isBusiness) {
    return (
      <div>
        <SheetHead
          icon="Briefcase"
          color={color}
          title={item.name}
          sub="Business account"
          amount={formatCurrency(item.balance ?? 0, { compact: true })}
        />
        <p className="mt-1 text-[13px] text-text-muted">
          This account&apos;s money is tracked separately — earnings, expenses, and net profit,
          month by month. It stays out of your personal budget.
        </p>
        <a
          href="/business"
          className="mt-4 block rounded-xl bg-surface-2 px-4 py-3 text-center text-sm font-semibold text-primary"
        >
          Open the business breakdown →
        </a>
      </div>
    );
  }
  return <InvestAccountDetail item={item} color={color} accountId={accountId} holdings={holdings} setHoldings={setHoldings} />;
}

function InvestAccountDetail({
  item,
  color,
  accountId,
  holdings,
  setHoldings,
}: {
  item: HiveItem;
  color: string;
  accountId: string;
  holdings: Holding[] | null;
  setHoldings: (h: Holding[] | null) => void;
}) {

  useEffect(() => {
    let alive = true;
    setHoldings(null);
    fetch(`/api/holdings?account=${accountId}`)
      .then((r) => r.json())
      .then((j) => alive && setHoldings(j.holdings ?? []))
      .catch(() => alive && setHoldings([]));
    return () => {
      alive = false;
    };
  }, [accountId]);

  const total = item.balance ?? 0;

  return (
    <div>
      <SheetHead
        icon={item.icon}
        color={color}
        title={item.name}
        sub="Account balance"
        amount={formatCurrency(total, { compact: true })}
      />
      {holdings === null ? (
        <div className="mt-3 h-24 animate-pulse rounded-xl bg-surface-2" />
      ) : holdings.length === 0 ? (
        <p className="mt-2 text-[13px] text-text-muted">
          Balances sync from your bank. Individual holdings (stocks, crypto) light up when the
          account is connected through Plaid Investments.
        </p>
      ) : (
        <div className="mt-1">
          {holdings.map((h) => (
            <div key={h.id} className="flex items-center gap-3 border-t border-border py-2.5">
              <HexIcon icon={KIND_ICON[h.kind] ?? "TrendingUp"} color={color} size={30} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {h.symbol} <span className="font-normal text-text-muted">{h.name}</span>
                </p>
                <p className="text-[11px] text-text-faint">
                  {h.kind === "cash"
                    ? "Cash"
                    : `${h.quantity} × ${formatCurrency(h.price)}`}
                </p>
              </div>
              <div className="text-right">
                <p className="font-bold tabular-nums">{formatCurrency(h.value)}</p>
                {total > 0 && (
                  <p className="text-[11px] font-semibold text-text-faint">
                    {Math.round((h.value / total) * 100)}%
                  </p>
                )}
              </div>
            </div>
          ))}
          <p className="mt-3 text-[11px] text-text-faint">
            Sample holdings — live positions sync when the account connects through Plaid
            Investments.
          </p>
        </div>
      )}
    </div>
  );
}

function CategoryTimeline({
  branch,
  item,
  color,
  windowSpec,
  windowLabel,
}: {
  branch: HiveBranch;
  item: HiveItem;
  color: string;
  windowSpec?: string | null;
  windowLabel: string;
}) {
  const [txns, setTxns] = useState<Transaction[] | null>(null);
  const [scope, setScope] = useState<AccountScope>(ALL_ACCOUNTS);

  // Looking at a different category resets to "all banks & cards".
  useEffect(() => setScope(ALL_ACCOUNTS), [item.categoryId]);

  useEffect(() => {
    let alive = true;
    setTxns(null);
    if (!item.categoryId) return;
    const p = new URLSearchParams({ category: item.categoryId, limit: "20" });
    scopeParams(scope, p);
    windowParams(windowSpec, p);
    fetch(`/api/transactions?${p.toString()}`)
      .then((r) => r.json())
      .then((j) => {
        if (alive) setTxns(j.transactions ?? []);
      })
      .catch(() => alive && setTxns([]));
    return () => {
      alive = false;
    };
  }, [item.categoryId, scope, windowSpec]);

  const isNeed = NEEDS_CATEGORIES.includes(item.name);

  return (
    <div>
      <SheetHead
        icon={item.icon}
        color={color}
        title={item.name}
        sub={`Purchases · ${windowLabel}`}
        amount={formatCurrency(item.value)}
      />
      <div className="mb-1 flex items-center gap-2">
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
          style={{
            color: isNeed ? "var(--needs)" : "var(--wants)",
            background: `color-mix(in srgb, ${isNeed ? "var(--needs)" : "var(--wants)"} 15%, transparent)`,
          }}
        >
          {isNeed ? "Need" : "Want"}
        </span>
        {item.trendPct != null && (
          <span
            className="text-xs font-bold"
            style={{ color: item.trendGood ? "var(--positive)" : "var(--negative)" }}
          >
            {item.trendPct > 0 ? "▲" : "▼"} {Math.abs(item.trendPct)}% vs the span before
          </span>
        )}
      </div>
      <div className="mt-2">
        <AccountFilter value={scope} onChange={setScope} compact />
      </div>
      {txns === null ? (
        <div className="mt-3 h-32 animate-pulse rounded-xl bg-surface-2" />
      ) : txns.length === 0 ? (
        <p className="mt-3 text-sm text-text-faint">No purchases found.</p>
      ) : (
        <div className="mt-1">
          {txns.map((t) => (
            <div key={t.id} className="flex items-center gap-3 border-t border-border py-2.5">
              <HexIcon icon={item.icon} color={color} size={28} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{t.merchantName || t.name}</p>
                <p className="truncate text-[11px] text-text-faint">
                  {dayLabel(t.date)}
                  {t.account ? ` · ${t.account.name}${t.account.mask ? ` ··${t.account.mask}` : ""}` : ""}
                </p>
              </div>
              <span className="font-bold tabular-nums">{formatCurrency(t.amount)}</span>
            </div>
          ))}
          <p className="mt-3 text-[11px] text-text-faint">
            Banks always report the date; exact times appear when your bank provides them.
          </p>
        </div>
      )}
    </div>
  );
}
