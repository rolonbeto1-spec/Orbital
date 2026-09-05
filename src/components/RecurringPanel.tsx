"use client";

import { useState } from "react";
import { Repeat2, ChevronDown } from "lucide-react";
import { useApi } from "@/lib/client";
import { formatCurrency, formatDateShort } from "@/lib/format";
import { Card } from "@/components/Section";

// Every recurring charge the detector finds across all transactions, with
// per-charge options — including the AI cancel helper.

interface RecurringItem {
  merchant: string;
  cadence: string;
  amount: number;
  monthlyCost: number;
  nextExpected: string;
}

interface CancelPlan {
  merchant: string;
  steps: string[];
  url: string | null;
  supportEmail: string | null;
  emailSubject: string;
  emailBody: string;
}

export function RecurringPanel() {
  const { data } = useApi<{ recurring: RecurringItem[]; monthlyTotal: number }>("/api/recurring");
  const [open, setOpen] = useState<string | null>(null);
  const [plan, setPlan] = useState<CancelPlan | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const items = data?.recurring ?? [];

  async function buildPlan(merchant: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/cancel-help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchant, name, email }),
      });
      if (res.ok) setPlan((await res.json()) as CancelPlan);
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) {
    return (
      <p className="px-5 py-10 text-center text-sm text-text-faint">
        No recurring charges detected yet — they show up once a merchant has
        charged you 3+ times on a steady rhythm.
      </p>
    );
  }

  return (
    <div className="space-y-3 px-5">
      <Card>
        <div className="flex items-baseline justify-between px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Recurring total
            </p>
            <p className="font-heading text-2xl font-bold tabular-nums">
              {formatCurrency(data?.monthlyTotal ?? 0)}
              <span className="text-sm font-medium text-text-muted">/mo</span>
            </p>
          </div>
          <p className="text-xs text-text-faint">
            ≈ {formatCurrency((data?.monthlyTotal ?? 0) * 12)}/yr
          </p>
        </div>
      </Card>

      <Card>
        {items.map((r, i) => {
          const isOpen = open === r.merchant;
          return (
            <div key={r.merchant} className={i > 0 ? "border-t border-border" : ""}>
              <button
                onClick={() => {
                  setOpen(isOpen ? null : r.merchant);
                  setPlan(null);
                }}
                className="flex w-full items-center gap-3 px-5 py-3.5 text-left"
              >
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center"
                  style={{
                    clipPath: "var(--hex)",
                    background: "color-mix(in oklab, var(--primary) 14%, transparent)",
                    color: "var(--primary)",
                  }}
                >
                  <Repeat2 size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.merchant}</span>
                  <span className="block text-xs text-text-muted">
                    {r.cadence} · next ~{formatDateShort(r.nextExpected)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-semibold tabular-nums">
                    {formatCurrency(r.amount)}
                  </span>
                  <span className="block text-[11px] text-text-faint">
                    {formatCurrency(r.monthlyCost)}/mo
                  </span>
                </span>
                <ChevronDown
                  size={15}
                  className="shrink-0 text-text-faint transition-transform"
                  style={{ transform: isOpen ? "rotate(180deg)" : "none" }}
                />
              </button>

              {isOpen && (
                <div className="border-t border-border bg-surface-2/50 px-5 py-4">
                  {!plan ? (
                    <div className="space-y-2">
                      <p className="text-xs text-text-muted">
                        Want out? I&apos;ll figure out how {r.merchant} does cancellations and
                        write the email for you.
                      </p>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Name on the account"
                        className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                      />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Email the account is under"
                        className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                      />
                      <button
                        disabled={busy}
                        onClick={() => buildPlan(r.merchant)}
                        className="btn btn-primary px-4 py-2 text-xs"
                      >
                        {busy ? "Working it out…" : "Help me cancel it"}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2.5 text-sm">
                      <ol className="list-decimal space-y-1 pl-5 text-[13px] text-text-muted">
                        {plan.steps.map((s, j) => (
                          <li key={j}>{s}</li>
                        ))}
                      </ol>
                      <div className="flex flex-wrap gap-1.5">
                        {plan.url && (
                          <a
                            href={plan.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-primary px-3.5 py-2 text-xs"
                          >
                            Open cancel page
                          </a>
                        )}
                        <a
                          href={`mailto:${plan.supportEmail ?? ""}?subject=${encodeURIComponent(plan.emailSubject)}&body=${encodeURIComponent(plan.emailBody)}`}
                          className="btn btn-ghost px-3.5 py-2 text-xs"
                        >
                          {plan.supportEmail ? "Open email draft" : "Draft email"}
                        </a>
                        <button
                          onClick={() =>
                            navigator.clipboard?.writeText(
                              `${plan.emailSubject}\n\n${plan.emailBody}`,
                            )
                          }
                          className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-muted active:scale-95"
                        >
                          Copy email text
                        </button>
                      </div>
                      <p className="text-[11px] text-text-faint">
                        Sends from your own mail app — you press Send.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </Card>
    </div>
  );
}
