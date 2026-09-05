import { Landmark, CreditCard, PiggyBank, TrendingUp, Wallet } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import type { Account } from "@/lib/types";

function accountIcon(type: string, subtype: string | null) {
  if (type === "credit") return CreditCard;
  if (type === "loan") return Landmark;
  if (type === "investment") return TrendingUp;
  if (subtype === "savings") return PiggyBank;
  return Wallet;
}

const TYPE_LABEL: Record<string, string> = {
  depository: "Cash",
  credit: "Credit",
  loan: "Loan",
  investment: "Investment",
};

export function AccountRow({ account }: { account: Account }) {
  const Icon = accountIcon(account.type, account.subtype);
  const isLiability = account.type === "credit" || account.type === "loan";
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Icon size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium capitalize">{account.name}</p>
        <p className="text-xs text-text-muted">
          {account.subtype || TYPE_LABEL[account.type] || account.type}
          {account.mask && ` ·••${account.mask}`}
        </p>
      </div>
      <div className="text-right">
        <p
          className="font-semibold tabular-nums"
          style={{ color: isLiability ? "var(--negative)" : "var(--text)" }}
        >
          {isLiability ? "-" : ""}
          {formatCurrency(account.currentBalance)}
        </p>
        {account.availableBalance != null && !isLiability && (
          <p className="text-xs text-text-faint tabular-nums">
            {formatCurrency(account.availableBalance)} avail
          </p>
        )}
      </div>
    </div>
  );
}
