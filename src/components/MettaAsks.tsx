"use client";

import { useState } from "react";
import { HelpCircle, Repeat2, Sparkles } from "lucide-react";
import { useApi, apiPost } from "@/lib/client";
import { formatCurrency, formatDateShort } from "@/lib/format";
import { Card, Section } from "@/components/Section";
import type { Category } from "@/lib/types";

// The app asks about things it doesn't understand: mystery charges get
// one-tap category answers (which teach it permanently), and recurring
// charges get an "are you aware?" check-in.

interface ChargeQ {
  kind: "charge";
  txnId: string;
  merchant: string;
  amount: number;
  date: string;
}
interface RecurringQ {
  kind: "recurring";
  merchant: string;
  amount: number;
  cadence: string;
  monthlyCost: number;
}
interface DigestQ {
  kind: "digest";
}
type Question = ChargeQ | RecurringQ | DigestQ;

interface CancelPlan {
  merchant: string;
  steps: string[];
  url: string | null;
  supportEmail: string | null;
  emailSubject: string;
  emailBody: string;
}

interface Digest {
  spending: number;
  prevSpending: number;
  trendPct: number | null;
  income: number;
  topCategories: { name: string; total: number }[];
  biggest: { merchant: string; amount: number } | null;
}

const QUICK_CATEGORIES = ["Food & Dining", "Groceries", "Shopping", "Transportation"];

export function MettaAsks() {
  const { data, refetch } = useApi<{ questions: Question[] }>("/api/questions");
  const { data: catData } = useApi<{ categories: Category[] }>("/api/categories");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [moreFor, setMoreFor] = useState<string | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [cancelFor, setCancelFor] = useState<string | null>(null);
  const [cancelPlan, setCancelPlan] = useState<CancelPlan | null>(null);
  const [cancelName, setCancelName] = useState("");
  const [cancelEmail, setCancelEmail] = useState("");
  const [planBusy, setPlanBusy] = useState(false);

  async function buildPlan(merchant: string) {
    setPlanBusy(true);
    try {
      const res = await fetch("/api/cancel-help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchant, name: cancelName, email: cancelEmail }),
      });
      if (res.ok) setCancelPlan((await res.json()) as CancelPlan);
    } finally {
      setPlanBusy(false);
    }
  }

  const questions = data?.questions ?? [];
  if (questions.length === 0) return null;

  const allExpense = (catData?.categories ?? []).filter((c) => c.group === "expense");

  async function answer(key: string, payload: Record<string, unknown>) {
    if (busyKey) return;
    setBusyKey(key);
    try {
      await apiPost("/api/questions", payload);
      await refetch();
    } finally {
      setBusyKey(null);
      setMoreFor(null);
    }
  }

  return (
    <Section title="Metta asks">
      <div className="stagger space-y-2.5">
        {questions.map((q) => {
          const key = q.kind === "charge" ? q.txnId : q.kind === "recurring" ? `r:${q.merchant}` : "digest";
          const busy = busyKey === key;
          if (q.kind === "digest") {
            return (
              <Card key={key}>
                <div className="p-4">
                  <div className="flex items-start gap-2.5">
                    <span
                      className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center text-white"
                      style={{ clipPath: "var(--hex)", background: "var(--invest)" }}
                    >
                      <Sparkles size={16} />
                    </span>
                    <p className="text-sm leading-snug">
                      {digest ? <b>Your week in 20 seconds</b> : "Want your week in 20 seconds?"}
                    </p>
                  </div>
                  {digest ? (
                    <div className="mt-3 space-y-2 text-sm">
                      <p>
                        Spent <b className="tabular-nums">{formatCurrency(digest.spending)}</b>
                        {digest.trendPct != null && (
                          <span
                            className="ml-1.5 text-xs font-semibold"
                            style={{
                              color: digest.trendPct <= 0 ? "var(--positive)" : "var(--negative)",
                            }}
                          >
                            {digest.trendPct > 0 ? "▲" : "▼"}
                            {Math.abs(digest.trendPct)}% vs last week
                          </span>
                        )}
                        {digest.income > 0 && (
                          <>
                            {" · "}made{" "}
                            <b className="tabular-nums text-positive">
                              {formatCurrency(digest.income)}
                            </b>
                          </>
                        )}
                      </p>
                      {digest.topCategories.length > 0 && (
                        <p className="text-text-muted">
                          Mostly{" "}
                          {digest.topCategories
                            .map((c) => `${c.name} (${formatCurrency(c.total)})`)
                            .join(", ")}
                        </p>
                      )}
                      {digest.biggest && (
                        <p className="text-text-muted">
                          Biggest: {digest.biggest.merchant} —{" "}
                          <b className="tabular-nums text-text">
                            {formatCurrency(digest.biggest.amount)}
                          </b>
                        </p>
                      )}
                      <button
                        disabled={busy}
                        onClick={() => {
                          setDigest(null);
                          void answer(key, { kind: "digest" });
                        }}
                        className="btn btn-primary mt-1 px-4 py-2 text-xs"
                      >
                        Done — see you next week
                      </button>
                    </div>
                  ) : (
                    <div className="mt-3 flex gap-1.5">
                      <button
                        disabled={busy}
                        onClick={async () => {
                          const res = await fetch("/api/digest");
                          if (res.ok) setDigest((await res.json()) as Digest);
                        }}
                        className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text active:scale-95"
                      >
                        Show me
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => answer(key, { kind: "digest" })}
                        className="rounded-full px-3 py-1.5 text-xs font-semibold text-text-faint active:scale-95"
                      >
                        Not now
                      </button>
                    </div>
                  )}
                </div>
              </Card>
            );
          }
          return (
            <Card key={key}>
              <div className="p-4">
                {q.kind === "charge" ? (
                  <>
                    <div className="flex items-start gap-2.5">
                      <span
                        className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center text-white"
                        style={{ clipPath: "var(--hex)", background: "var(--primary)" }}
                      >
                        <HelpCircle size={16} />
                      </span>
                      <p className="text-sm leading-snug">
                        What was the{" "}
                        <b className="tabular-nums">{formatCurrency(q.amount)}</b> at{" "}
                        <b>{q.merchant}</b> for?{" "}
                        <span className="text-text-faint">({formatDateShort(q.date)})</span>
                      </p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {QUICK_CATEGORIES.map((name) => (
                        <button
                          key={name}
                          disabled={busy}
                          onClick={() =>
                            answer(key, { kind: "charge", txnId: q.txnId, categoryName: name })
                          }
                          className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text active:scale-95"
                        >
                          {name}
                        </button>
                      ))}
                      {moreFor === key ? (
                        <select
                          autoFocus
                          disabled={busy}
                          defaultValue=""
                          onChange={(e) =>
                            e.target.value &&
                            answer(key, {
                              kind: "charge",
                              txnId: q.txnId,
                              categoryName: e.target.value,
                            })
                          }
                          className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold outline-none"
                        >
                          <option value="" disabled>
                            Pick one…
                          </option>
                          {allExpense.map((c) => (
                            <option key={c.id} value={c.name}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <button
                          disabled={busy}
                          onClick={() => setMoreFor(key)}
                          className="rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold text-text-muted active:scale-95"
                        >
                          More…
                        </button>
                      )}
                      <button
                        disabled={busy}
                        onClick={() => answer(key, { kind: "charge", txnId: q.txnId })}
                        className="rounded-full px-3 py-1.5 text-xs font-semibold text-text-faint active:scale-95"
                      >
                        Skip
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-start gap-2.5">
                      <span
                        className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center text-white"
                        style={{ clipPath: "var(--hex)", background: "var(--wants)" }}
                      >
                        <Repeat2 size={16} />
                      </span>
                      <p className="text-sm leading-snug">
                        Are you aware of this recurring charge? <b>{q.merchant}</b> —{" "}
                        <b className="tabular-nums">{formatCurrency(q.amount)}</b> {q.cadence} (
                        {formatCurrency(q.monthlyCost)}/mo)
                      </p>
                    </div>
                    {cancelFor !== q.merchant ? (
                      <div className="mt-3 flex gap-1.5">
                        <button
                          disabled={busy}
                          onClick={() => answer(key, { kind: "recurring", merchant: q.merchant })}
                          className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text active:scale-95"
                        >
                          Yes, I know about it
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => {
                            setCancelFor(q.merchant);
                            setCancelPlan(null);
                          }}
                          className="rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold text-negative active:scale-95"
                        >
                          Help me cancel it
                        </button>
                      </div>
                    ) : !cancelPlan ? (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs text-text-muted">
                          I&apos;ll work out how to cancel {q.merchant} and write the email for
                          you. Your details go straight into the draft — nowhere else.
                        </p>
                        <input
                          type="text"
                          value={cancelName}
                          onChange={(e) => setCancelName(e.target.value)}
                          placeholder="Name on the account"
                          className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                        />
                        <input
                          type="email"
                          value={cancelEmail}
                          onChange={(e) => setCancelEmail(e.target.value)}
                          placeholder="Email the account is under"
                          className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                        />
                        <div className="flex gap-1.5">
                          <button
                            disabled={planBusy}
                            onClick={() => buildPlan(q.merchant)}
                            className="btn btn-primary px-4 py-2 text-xs"
                          >
                            {planBusy ? "Working it out…" : "Build my cancel plan"}
                          </button>
                          <button
                            onClick={() => setCancelFor(null)}
                            className="rounded-full px-3 py-1.5 text-xs font-semibold text-text-faint"
                          >
                            Back
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 space-y-2.5 text-sm">
                        <ol className="list-decimal space-y-1 pl-5 text-[13px] text-text-muted">
                          {cancelPlan.steps.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ol>
                        <div className="flex flex-wrap gap-1.5">
                          {cancelPlan.url && (
                            <a
                              href={cancelPlan.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn-primary px-3.5 py-2 text-xs"
                            >
                              Open cancel page
                            </a>
                          )}
                          <a
                            href={`mailto:${cancelPlan.supportEmail ?? ""}?subject=${encodeURIComponent(cancelPlan.emailSubject)}&body=${encodeURIComponent(cancelPlan.emailBody)}`}
                            className="btn btn-ghost px-3.5 py-2 text-xs"
                          >
                            {cancelPlan.supportEmail
                              ? "Open email draft"
                              : "Draft email (add their address)"}
                          </a>
                          <button
                            onClick={() =>
                              navigator.clipboard?.writeText(
                                `${cancelPlan.emailSubject}\n\n${cancelPlan.emailBody}`,
                              )
                            }
                            className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-muted active:scale-95"
                          >
                            Copy email text
                          </button>
                        </div>
                        <p className="text-[11px] text-text-faint">
                          The email opens in your own mail app and sends from your address — you
                          press Send. Metta never touches your email account.
                        </p>
                        <button
                          disabled={busy}
                          onClick={() => {
                            setCancelFor(null);
                            setCancelPlan(null);
                            void answer(key, { kind: "recurring", merchant: q.merchant });
                          }}
                          className="btn btn-primary px-4 py-2 text-xs"
                        >
                          Done — stop asking about this one
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </Section>
  );
}
