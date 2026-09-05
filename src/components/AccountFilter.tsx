"use client";

import { CreditCard, Landmark } from "lucide-react";
import { useApi } from "@/lib/client";
import type { BankWithAccounts } from "@/lib/types";

// One scope for "which money am I looking at": everything (default), one bank
// (all its accounts), or one specific account/card.
export interface AccountScope {
  bank: string | null;
  account: string | null;
}

export const ALL_ACCOUNTS: AccountScope = { bank: null, account: null };

export function scopeParams(scope: AccountScope, p: URLSearchParams) {
  if (scope.account) p.set("account", scope.account);
  else if (scope.bank) p.set("bank", scope.bank);
  return p;
}

export function AccountFilter({
  value,
  onChange,
  compact = false,
}: {
  value: AccountScope;
  onChange: (scope: AccountScope) => void;
  compact?: boolean;
}) {
  const { data } = useApi<{ items: BankWithAccounts[] }>("/api/accounts");
  const banks = data?.items ?? [];
  const multiBank = banks.length > 1;
  if (banks.length === 0) return null;

  const pad = compact ? "px-2.5 py-1" : "px-3 py-1.5";
  const text = compact ? "text-[11px]" : "text-xs";

  return (
    <div className={`flex gap-2 overflow-x-auto ${compact ? "" : "px-5"} pb-1`}>
      <FilterChip
        active={!value.bank && !value.account}
        onClick={() => onChange(ALL_ACCOUNTS)}
        pad={pad}
        text={text}
      >
        All banks &amp; cards
      </FilterChip>
      {banks.map((b) => (
        <span key={b.id} className="flex gap-2">
          {/* A whole-bank chip only earns its spot when it groups 2+ accounts. */}
          {multiBank && b.accounts.length > 1 && (
            <FilterChip
              active={value.bank === b.id && !value.account}
              onClick={() =>
                onChange(value.bank === b.id && !value.account ? ALL_ACCOUNTS : { bank: b.id, account: null })
              }
              pad={pad}
              text={text}
            >
              <Landmark size={compact ? 11 : 13} />
              {shortBank(b.institutionName)}
            </FilterChip>
          )}
          {b.accounts.map((a) => (
            <FilterChip
              key={a.id}
              active={value.account === a.id}
              onClick={() =>
                onChange(value.account === a.id ? ALL_ACCOUNTS : { bank: null, account: a.id })
              }
              pad={pad}
              text={text}
            >
              {a.type === "credit" ? (
                <CreditCard size={compact ? 11 : 13} />
              ) : (
                <Landmark size={compact ? 11 : 13} />
              )}
              {a.name}
              {a.mask && <span className="opacity-70">··{a.mask}</span>}
            </FilterChip>
          ))}
        </span>
      ))}
    </div>
  );
}

function shortBank(name: string) {
  return name.replace(/\s*\(sample( data)?\)\s*/i, "");
}

function FilterChip({
  children,
  active,
  onClick,
  pad,
  text,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  pad: string;
  text: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold transition-colors ${pad} ${text}`}
      style={{
        borderColor: active ? "transparent" : "var(--border)",
        background: active ? "var(--primary)" : "var(--surface)",
        color: active ? "#fff" : "var(--text-muted)",
      }}
    >
      {children}
    </button>
  );
}
