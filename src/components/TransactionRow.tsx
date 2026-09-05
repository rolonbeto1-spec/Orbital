import { useState } from "react";
import { CategoryIcon } from "@/components/CategoryIcon";
import { formatCurrency, formatDateShort } from "@/lib/format";
import type { Transaction } from "@/lib/types";

// Stable per-merchant tint so the monogram under a logo reads like a real
// brand chip — and a blocked or missing logo never leaves an empty circle.
const BRAND_HUES = [152, 198, 262, 32, 340, 178, 220, 12];
function brandTint(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 9973;
  const hue = BRAND_HUES[h % BRAND_HUES.length];
  return {
    background: `oklch(0.42 0.09 ${hue} / 0.28)`,
    color: `oklch(0.55 0.13 ${hue})`,
  };
}

function MerchantMark({ name, logoUrl }: { name: string; logoUrl: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span
      className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border border-border text-[11px] font-bold tracking-wide"
      style={brandTint(name)}
      aria-hidden
    >
      <span className={loaded ? "opacity-0" : ""}>{name.slice(0, 2).toUpperCase()}</span>
      {!failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full bg-white object-contain p-[3px] transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </span>
  );
}

export function TransactionRow({
  txn,
  recurring,
  onClick,
}: {
  txn: Transaction;
  recurring?: boolean;
  onClick?: () => void;
}) {
  const isIncome = txn.amount < 0; // Plaid: negative = money in
  const display = formatCurrency(Math.abs(txn.amount));
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors active:bg-surface-2"
    >
      {txn.logoUrl ? (
        <MerchantMark name={txn.merchantName || txn.name} logoUrl={txn.logoUrl} />
      ) : (
        <CategoryIcon icon={txn.category?.icon} color={txn.category?.color} />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {txn.merchantName || txn.name}
          {recurring && (
            <span
              className="ml-1.5 inline-block rounded-full px-1.5 py-px align-middle text-[9px] font-bold uppercase tracking-wide"
              style={{ color: "var(--primary)", background: "var(--primary-soft)" }}
            >
              Repeats
            </span>
          )}
        </p>
        <p className="truncate text-xs text-text-muted">
          {txn.category?.name || "Uncategorized"}
          {txn.pending && " · Pending"}
          {" · "}
          {formatDateShort(txn.date)}
          {txn.account && ` · ${txn.account.name}`}
        </p>
        {txn.owedBack && (
          <span
            className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{
              color: (txn.reimbursedAmount ?? 0) >= txn.amount ? "var(--positive)" : "var(--primary)",
              background:
                (txn.reimbursedAmount ?? 0) >= txn.amount
                  ? "color-mix(in srgb, var(--positive) 15%, transparent)"
                  : "var(--primary-soft)",
            }}
          >
            {(txn.reimbursedAmount ?? 0) >= txn.amount
              ? "Paid back"
              : `Owed ${formatCurrency(txn.amount - (txn.reimbursedAmount ?? 0))}`}
          </span>
        )}
      </div>
      <span
        className="shrink-0 font-semibold tabular-nums"
        style={{ color: isIncome ? "var(--positive)" : "var(--text)" }}
      >
        {isIncome ? "+" : "-"}
        {display}
      </span>
    </button>
  );
}
